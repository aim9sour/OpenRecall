import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingHelp } from "./SettingHelp.js";

describe("SettingHelp", () => {
  it("does not force long help into a control's focus announcement", async () => {
    const user = userEvent.setup();
    render(<><label htmlFor="retention">معدل الاحتفاظ المطلوب</label><input id="retention" /><SettingHelp label="شرح معدل الاحتفاظ">الوصف الطويل</SettingHelp></>);
    const input = screen.getByLabelText("معدل الاحتفاظ المطلوب");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    const summary = screen.getByText("شرح معدل الاحتفاظ");
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    await user.click(summary);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(true);
  });
});
