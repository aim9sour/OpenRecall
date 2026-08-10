import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DisclosureSection } from "./DisclosureSection.js";

describe("DisclosureSection", () => {
  it("keeps collapsed controls out of the accessibility tree and opens on demand", async () => {
    const user = userEvent.setup();
    render(<DisclosureSection heading="Advanced training"><button>Save training</button></DisclosureSection>);
    const toggle = screen.getByRole("button", { name: "Advanced training" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Save training" })).toBeNull();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Save training" }).hidden).toBe(false);
  });
});
