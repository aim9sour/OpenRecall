import type { Card, CardPresentationEdit } from "@openrecall/contracts";
import { useState } from "react";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

type DraftPresentation = CardPresentationEdit & { readonly key: string };

function draftsFrom(card: Card): DraftPresentation[] {
  return card.presentations.map((presentation) => ({
    id: presentation.id,
    front: presentation.front,
    back: presentation.back,
    notes: presentation.notes,
    key: presentation.id,
  }));
}

export function CardEditor({
  api,
  card,
  onUpdated,
}: {
  readonly api: ApiClient;
  readonly card: Card;
  readonly onUpdated: (card: Card) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState(() => draftsFrom(card));
  const [busy, setBusy] = useState(false);
  const [errorKeys, setErrorKeys] = useState<readonly string[]>([]);
  const { t } = useI18n();

  const updateDraft = (
    index: number,
    field: "front" | "back" | "notes",
    value: string,
  ): void => {
    setDrafts((current) =>
      current.map((draft, candidateIndex) =>
        candidateIndex === index ? { ...draft, [field]: value } : draft,
      ),
    );
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setErrorKeys([]);
    try {
      const updated = await api.put<Card>(`/api/v1/cards/${card.id}`, {
        expectedUpdatedAtMs: card.updatedAtMs,
        presentations: drafts.map(({ id, front, back, notes }) => ({
          ...(id === undefined ? {} : { id }),
          front,
          back,
          notes,
        })),
      });
      onUpdated(updated);
      setDrafts(draftsFrom(updated));
      setEditing(false);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorKeys(
          error.envelope.fieldErrors?.map(({ messageKey }) => messageKey) ?? [
            error.envelope.messageKey,
          ],
        );
      } else {
        setErrorKeys(["error.internal"]);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <>
        <ol className="presentation-list">
          {card.presentations.map((presentation, index) => (
            <li key={presentation.id}>
              <h4>
                {index === 0
                  ? t("card.primary")
                  : t("card.variant", { number: index })}
              </h4>
              <p dir="auto">{presentation.front}</p>
              <p dir="auto">{presentation.back}</p>
              {presentation.notes !== null &&
                presentation.notes.trim() !== "" && (
                  <p dir="auto">{presentation.notes}</p>
                )}
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setEditing(true)}>
          {t("card.edit")}
        </button>
      </>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {errorKeys.length > 0 && (
        <div role="alert" tabIndex={-1}>
          <h4>{t("error.summary")}</h4>
          <ul>
            {errorKeys.map((key, index) => (
              <li key={`${key}-${index}`}>{t(key)}</li>
            ))}
          </ul>
        </div>
      )}
      {drafts.map((draft, index) => (
        <fieldset key={draft.key}>
          <legend>
            {index === 0
              ? t("card.primary")
              : t("card.variant", { number: index })}
          </legend>
          <label>
            {t("import.front")}
            <input
              required
              value={draft.front}
              onChange={(event) =>
                updateDraft(index, "front", event.currentTarget.value)
              }
            />
          </label>
          <label>
            {t("import.back")}
            <textarea
              required
              value={draft.back}
              onChange={(event) =>
                updateDraft(index, "back", event.currentTarget.value)
              }
            />
          </label>
          <label>
            {t("card.notes")}
            <textarea
              value={draft.notes ?? ""}
              onChange={(event) =>
                updateDraft(index, "notes", event.currentTarget.value)
              }
            />
          </label>
          {index > 0 && (
            <button
              type="button"
              onClick={() =>
                setDrafts((current) =>
                  current.filter((_, candidateIndex) => candidateIndex !== index),
                )
              }
            >
              {t("card.removeVariant", { number: index })}
            </button>
          )}
        </fieldset>
      ))}
      <div className="review-actions">
        <button
          type="button"
          onClick={() =>
            setDrafts((current) => [
              ...current,
              {
                key: crypto.randomUUID(),
                front: "",
                back: "",
                notes: null,
              },
            ])
          }
        >
          {t("card.addVariant")}
        </button>
        <button type="submit" disabled={busy}>
          {busy ? t("form.submitting") : t("card.save")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDrafts(draftsFrom(card));
            setErrorKeys([]);
            setEditing(false);
          }}
        >
          {t("review.cancel")}
        </button>
      </div>
    </form>
  );
}
