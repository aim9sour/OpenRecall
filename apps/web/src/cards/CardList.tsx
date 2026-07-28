import type { Card, CardLifecycle, CardPage } from "@openrecall/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { CardEditor } from "./CardEditor.js";
import { CardStatisticsDisclosure } from "./CardStatisticsDisclosure.js";
import { DeleteCardDialog } from "./DeleteCardDialog.js";

export function CardList({
  api,
  sectionId,
}: {
  readonly api: ApiClient;
  readonly sectionId: string;
}) {
  const [cards, setCards] = useState<readonly Card[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<CardLifecycle>("active");
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undoCard, setUndoCard] = useState<Card | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);
  const deleteOpenerRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const parameters = new URLSearchParams({
        lifecycle,
        limit: "25",
      });
      if (query !== "") parameters.set("query", query);
      if (cursor !== null) parameters.set("cursor", cursor);
      const page = await api.get<CardPage>(
        `/api/v1/sections/${encodeURIComponent(sectionId)}/cards?${parameters}`,
      );
      setCards(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setError(t("card.loadError"));
    } finally {
      setBusy(false);
    }
  }, [api, cursor, lifecycle, query, sectionId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceCard = (updated: Card): void => {
    setCards((current) =>
      current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    );
  };

  return (
    <section aria-labelledby="cards-heading">
      <h2 id="cards-heading">{t("card.listTitle")}</h2>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setCursor(null);
          setQuery(search.trim());
        }}
      >
        <label htmlFor="card-search">{t("card.search")}</label>
        <input
          id="card-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <button type="submit">{t("card.searchAction")}</button>
      </form>
      <label htmlFor="card-lifecycle">{t("card.status")}</label>
      <select
        id="card-lifecycle"
        value={lifecycle}
        onChange={(event) => {
          setCursor(null);
          setLifecycle(event.currentTarget.value as CardLifecycle);
        }}
      >
        <option value="active">{t("card.lifecycle.active")}</option>
        <option value="trashed">{t("card.lifecycle.trashed")}</option>
      </select>

      {error !== "" && <p role="alert">{error}</p>}
      {busy && <p role="status">{t("card.loading")}</p>}
      {!busy && cards.length === 0 && <p>{t("card.empty")}</p>}

      <div className="card-list">
        {cards.map((card) => {
          const primary = card.presentations[0];
          return (
            <article key={card.id} className="panel">
              <h3 dir="auto">{primary?.front ?? t("card.untitled")}</h3>
              <CardEditor api={api} card={card} onUpdated={replaceCard} />
              <CardStatisticsDisclosure api={api} card={card} />
              <div className="review-actions">
                {card.lifecycle === "active" && (
                  <button
                    type="button"
                    onClick={() => {
                      setBusy(true);
                      void api
                        .post<Card>(`/api/v1/cards/${card.id}/trash`, {
                          expectedUpdatedAtMs: card.updatedAtMs,
                        })
                        .then((trashed) => {
                          setCards((current) =>
                            current.filter(({ id }) => id !== card.id),
                          );
                          setUndoCard(trashed);
                        })
                        .catch(() => setError(t("card.actionError")))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t("card.trash")}
                  </button>
                )}
                <button
                  ref={deleteCard?.id === card.id ? deleteOpenerRef : undefined}
                  type="button"
                  onClick={(event) => {
                    deleteOpenerRef.current = event.currentTarget;
                    setDeleteCard(card);
                  }}
                >
                  {t("card.delete.open")}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {undoCard !== null && (
        <div role="status" className="panel">
          <p>{t("card.trashed")}</p>
          <button
            type="button"
            onClick={() => {
              const card = undoCard;
              setBusy(true);
              void api
                .post<Card>(`/api/v1/cards/${card.id}/restore`, {
                  expectedUpdatedAtMs: card.updatedAtMs,
                })
                .then((restored) => {
                  setCards((current) => [restored, ...current]);
                  setUndoCard(null);
                })
                .catch(() => setError(t("card.actionError")))
                .finally(() => setBusy(false));
            }}
          >
            {t("card.undoTrash")}
          </button>
        </div>
      )}

      {nextCursor !== null && (
        <button type="button" onClick={() => setCursor(nextCursor)}>
          {t("card.nextPage")}
        </button>
      )}

      {deleteCard !== null && (
        <DeleteCardDialog
          busy={busy}
          cardName={deleteCard.presentations[0]?.front ?? ""}
          openerRef={deleteOpenerRef}
          onCancel={() => setDeleteCard(null)}
          onConfirm={() => {
            const card = deleteCard;
            setBusy(true);
            void api
              .delete<void>(`/api/v1/cards/${card.id}/permanent`, {
                confirmationItemId: card.id,
                expectedUpdatedAtMs: card.updatedAtMs,
              })
              .then(() => {
                setCards((current) =>
                  current.filter(({ id }) => id !== card.id),
                );
                setDeleteCard(null);
              })
              .catch(() => setError(t("card.actionError")))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </section>
  );
}
