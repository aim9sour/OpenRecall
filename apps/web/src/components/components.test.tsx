import { createRef } from "react";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ErrorSummary } from "./ErrorSummary.js";
import { StatusBadge } from "./StatusBadge.js";

describe("semantic components", () => {
  it("focuses an error summary only after a failed submission", async () => {
    const { rerender } = render(
      <ErrorSummary
        title="Correct these fields"
        errors={[
          {
            id: "name-error",
            message: "Name is required",
            targetId: "name",
          },
        ]}
        focus={false}
      />,
    );
    const summary = screen.getByRole("alert");
    expect(document.activeElement).not.toBe(summary);

    rerender(
      <ErrorSummary
        title="Correct these fields"
        errors={[
          {
            id: "name-error",
            message: "Name is required",
            targetId: "name",
          },
        ]}
        focus
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(
      screen
        .getByRole("link", { name: "Name is required" })
        .getAttribute("href"),
    ).toBe("#name");
  });

  it("traps dialog focus, cancels with Escape, and restores its opener", async () => {
    const user = userEvent.setup();
    const openerRef = createRef<HTMLButtonElement>();
    const cancel = vi.fn();
    const confirm = vi.fn();
    const { rerender } = render(
      <>
        <button ref={openerRef}>Delete</button>
        <ConfirmDialog
          title="Delete this card?"
          description="This cannot be undone."
          confirmLabel="Delete permanently"
          cancelLabel="Cancel"
          busy={false}
          openerRef={openerRef}
          onCancel={cancel}
          onConfirm={confirm}
        />
      </>,
    );

    const confirmButton = screen.getByRole("button", {
      name: "Delete permanently",
    });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() =>
      expect(document.activeElement).toBe(confirmButton),
    );
    cancelButton.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(confirmButton);
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(cancelButton);
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledOnce();

    rerender(<button ref={openerRef}>Delete</button>);
    await waitFor(() =>
      expect(document.activeElement).toBe(openerRef.current),
    );
  });

  it("enters the browser modal layer when the native dialog API exists", () => {
    const showModalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "showModal",
    );
    const closeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "close",
    );
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: close,
    });

    try {
      const openerRef = createRef<HTMLButtonElement>();
      const { unmount } = render(
        <>
          <button ref={openerRef}>Delete</button>
          <ConfirmDialog
            title="Delete this card?"
            description="This cannot be undone."
            confirmLabel="Delete permanently"
            cancelLabel="Cancel"
            busy={false}
            openerRef={openerRef}
            onCancel={vi.fn()}
            onConfirm={vi.fn()}
          />
        </>,
      );

      expect(showModal).toHaveBeenCalledOnce();
      unmount();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      if (showModalDescriptor === undefined) {
        Reflect.deleteProperty(
          HTMLDialogElement.prototype,
          "showModal",
        );
      } else {
        Object.defineProperty(
          HTMLDialogElement.prototype,
          "showModal",
          showModalDescriptor,
        );
      }
      if (closeDescriptor === undefined) {
        Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
      } else {
        Object.defineProperty(
          HTMLDialogElement.prototype,
          "close",
          closeDescriptor,
        );
      }
    }
  });

  it("keeps status meaning in text rather than color alone", () => {
    render(<StatusBadge tone="success">Completed</StatusBadge>);
    const badge = screen.getByText("Completed");
    expect(badge.getAttribute("data-tone")).toBe("success");
  });
});
