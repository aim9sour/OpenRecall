import { useEffect, type RefObject } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

export function useReviewShortcuts(options: {
  readonly answerVisible: boolean;
  readonly endButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onRate: (rating: 1 | 2 | 3 | 4) => void;
  readonly onReveal: () => void;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target) ||
        document.querySelector("[role='dialog'][aria-modal='true']") !== null
      ) {
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        options.endButtonRef.current?.focus();
        return;
      }
      if (event.key === " " && !options.answerVisible) {
        event.preventDefault();
        options.onReveal();
        return;
      }
      if (options.answerVisible && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        options.onRate(Number(event.key) as 1 | 2 | 3 | 4);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [options]);
}
