import { createI18n } from "@openrecall/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../app/I18nProvider.js";
import { TechnicalSettingsPanel } from "./TechnicalSettingsPanel.js";
import { view } from "./test-optimizer-technical-fixture.js";

describe("TechnicalSettingsPanel", () => {
  it("shows official values as read-only definitions rather than controls", async () => {
    render(<I18nProvider i18n={await createI18n("en")}><TechnicalSettingsPanel info={view} /></I18nProvider>);
    expect(screen.getByText("2023")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
