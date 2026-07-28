import type { Card, CardPage } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { CardList } from "./CardList.js";

const SECTION_ID = "d9428888-122b-41e1-985c-61cd3cbb3210";
const CARD_ID = "a8f65aa8-122b-41e1-985c-61cd3cbb3210";
const SECOND_CARD_ID = "18f65aa8-122b-41e1-985c-61cd3cbb3210";

const card: Card = {
  id: CARD_ID,
  sectionId: SECTION_ID,
  lifecycle: "active",
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
  trashedAtMs: null,
  presentations: [
    {
      id: "b9f65aa8-122b-41e1-985c-61cd3cbb3210",
      kind: "primary",
      ordinal: 0,
      front: "Primary question",
      back: "Primary answer",
      notes: null,
    },
    {
      id: "c9f65aa8-122b-41e1-985c-61cd3cbb3210",
      kind: "variant",
      ordinal: 1,
      front: "Alternative wording",
      back: "Alternative answer",
      notes: "A note",
    },
  ],
};

const secondCard: Card = {
  ...card,
  id: SECOND_CARD_ID,
  presentations: [
    {
      ...card.presentations[0]!,
      id: "29f65aa8-122b-41e1-985c-61cd3cbb3210",
      front: "Second question",
    },
  ],
};

async function renderList(overrides: Partial<ApiClient> = {}) {
  const getMock = vi.fn(async (_path: string) => ({
      items: [card, secondCard],
      nextCursor: "next-page",
    }));
  const postMock = vi.fn(async (path: string, _body?: unknown) => ({
      ...card,
      lifecycle: path.endsWith("/trash") ? "trashed" : "active",
      updatedAtMs: path.endsWith("/trash") ? 2_000 : 3_000,
    }));
  const putMock = vi.fn(async (_path: string, _body?: unknown) => ({
    ...card,
    updatedAtMs: 2_000,
  }));
  const removeMock = vi.fn(async (_path: string, _body?: unknown) => undefined);
  const get: ApiClient["get"] = async <T,>(path: string) =>
    (await getMock(path)) as T;
  const post: ApiClient["post"] = async <T,>(
    path: string,
    body: unknown,
  ) => (await postMock(path, body)) as T;
  const put: ApiClient["put"] = async <T,>(
    path: string,
    body: unknown,
  ) => (await putMock(path, body)) as T;
  const remove: ApiClient["delete"] = async <T,>(
    path: string,
    body: unknown,
  ) => (await removeMock(path, body)) as T;
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      locale: "en",
    }),
    get: overrides.get ?? get,
    post: overrides.post ?? post,
    put: overrides.put ?? put,
    delete: overrides.delete ?? remove,
  };
  const i18n = await createI18n("en");
  const result = render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <CardList api={api} sectionId={SECTION_ID} />
      </MemoryRouter>
    </I18nProvider>,
  );
  return {
    ...result,
    api,
    get: getMock,
    post: postMock,
    put: putMock,
    remove: removeMock,
  };
}

describe("CardList", () => {
  it("supports keyboard search, lifecycle filtering, pagination, and presentation labels", async () => {
    const user = userEvent.setup();
    const { get } = await renderList();

    await screen.findByRole("heading", { name: "Primary question" });
    expect(screen.getAllByText("Primary presentation")).toHaveLength(2);
    expect(screen.getByText("Variant 1")).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Show card statistics" })[0]!
        .getAttribute("aria-expanded"),
    ).toBe("false");

    const search = screen.getByRole("searchbox", { name: "Search cards" });
    await user.type(search, "mitochondria{Enter}");
    await waitFor(() =>
      expect(
        get.mock.calls.some(([path]) =>
          String(path).includes("query=mitochondria"),
        ),
      ).toBe(true),
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Card status" }),
      "trashed",
    );
    await waitFor(() =>
      expect(
        get.mock.calls.some(([path]) =>
          String(path).includes("lifecycle=trashed"),
        ),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(
        get.mock.calls.some(([path]) =>
          String(path).includes("cursor=next-page"),
        ),
      ).toBe(true),
    );
  });

  it("adds/removes variants and keeps field values visible after a server error", async () => {
    const user = userEvent.setup();
    const put: ApiClient["put"] = async () => {
      throw new ApiClientError(400, {
        code: "VALIDATION_ERROR",
        messageKey: "error.validation",
        fieldErrors: [
          {
            path: "presentations[0].front",
            messageKey: "import.markupNotAllowed",
          },
        ],
      });
    };
    await renderList({ put });
    await screen.findByRole("heading", { name: "Primary question" });

    await user.click(
      screen.getAllByRole("button", { name: "Edit card" })[0]!,
    );
    expect(
      screen.getByRole("group", { name: "Primary presentation" }),
    ).not.toBeNull();
    expect(screen.getByRole("group", { name: "Variant 1" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Add variant" }));
    expect(screen.getByRole("group", { name: "Variant 2" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove variant 2" }));
    expect(screen.queryByRole("group", { name: "Variant 2" })).toBeNull();

    const question = within(
      screen.getByRole("group", { name: "Primary presentation" }),
    ).getByLabelText("Question", {
      selector: "input",
    });
    await user.clear(question);
    await user.type(question, "<b>Kept value</b>");
    await user.click(screen.getByRole("button", { name: "Save card" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "HTML markup is not allowed.",
    );
    expect((question as HTMLInputElement).value).toBe("<b>Kept value</b>");
  });

  it("offers an immediate undo after trashing the whole learning item", async () => {
    const user = userEvent.setup();
    const { post } = await renderList();
    await screen.findByRole("heading", { name: "Primary question" });

    await user.click(
      screen.getAllByRole("button", { name: "Move card to trash" })[0]!,
    );
    const undo = await screen.findByRole("button", { name: "Undo trash" });
    await user.click(undo);

    expect(
      post.mock.calls.map(([path]) => path),
    ).toEqual([
      `/api/v1/cards/${CARD_ID}/trash`,
      `/api/v1/cards/${CARD_ID}/restore`,
    ]);
  });

  it("traps and restores focus in the permanent-delete dialog", async () => {
    const user = userEvent.setup();
    const { remove } = await renderList();
    await screen.findByRole("heading", { name: "Primary question" });
    const opener = screen.getAllByRole("button", {
      name: "Delete card permanently",
    })[0]!;

    await user.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Permanently delete this card?",
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Confirm permanent deletion" }),
      ),
    );
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);
    await user.click(cancel);
    expect(dialog.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));

    await user.click(opener);
    await user.click(
      screen.getByRole("button", { name: "Confirm permanent deletion" }),
    );
    expect(remove).toHaveBeenCalledWith(
      `/api/v1/cards/${CARD_ID}/permanent`,
      {
        confirmationItemId: CARD_ID,
        expectedUpdatedAtMs: 1_000,
      },
    );
  });
});
