import { act, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReviewEvents } from "./use-review-events.js";

class FakeEventSource extends EventTarget {
  static latest: FakeEventSource | undefined;
  closed = false;

  constructor(_url: string | URL, _options?: EventSourceInit) {
    super();
    FakeEventSource.latest = this;
  }

  close(): void {
    this.closed = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.latest = undefined;
});

describe("useReviewEvents", () => {
  it("handles only its section deletion, disables recovery, and closes the stream", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const deleted = vi.fn();

    function Probe() {
      const [disabled, setDisabled] = useState(false);
      useReviewEvents({
        disabled,
        sectionId: "section-1",
        sessionId: "session-1",
        onSectionDeleted() {
          deleted();
          setDisabled(true);
        },
      });
      return null;
    }

    const router = createMemoryRouter([
      { path: "/", loader: () => null, element: <Probe /> },
    ]);
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(FakeEventSource.latest).toBeDefined());
    const source = FakeEventSource.latest!;

    act(() => {
      source.dispatchEvent(
        new MessageEvent("section-deleted", {
          data: JSON.stringify({ sectionId: "section-2" }),
        }),
      );
    });
    expect(deleted).not.toHaveBeenCalled();

    act(() => {
      source.dispatchEvent(
        new MessageEvent("section-deleted", {
          data: JSON.stringify({ sectionId: "section-1" }),
        }),
      );
    });
    await waitFor(() => expect(deleted).toHaveBeenCalledOnce());
    await waitFor(() => expect(source.closed).toBe(true));

    act(() => {
      window.dispatchEvent(new Event("focus"));
      source.dispatchEvent(
        new MessageEvent("section-deleted", {
          data: JSON.stringify({ sectionId: "section-1" }),
        }),
      );
    });
    expect(deleted).toHaveBeenCalledOnce();
  });
});
