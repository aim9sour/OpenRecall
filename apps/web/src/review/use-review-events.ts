import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

export function useReviewEvents({
  disabled,
  onSectionDeleted,
  sectionId,
  sessionId,
}: {
  readonly disabled: boolean;
  readonly onSectionDeleted: () => void;
  readonly sectionId: string;
  readonly sessionId: string;
}): void {
  const { revalidate: revalidateRoute } = useRevalidator();
  const deleted = useRef(disabled);

  useEffect(() => {
    if (disabled) {
      deleted.current = true;
      return;
    }
    deleted.current = false;
    const requestRevalidation = (): void => {
      if (!deleted.current) void revalidateRoute();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        requestRevalidation();
      }
    };

    window.addEventListener("online", requestRevalidation);
    window.addEventListener("focus", requestRevalidation);
    document.addEventListener("visibilitychange", onVisibility);

    const EventSourceConstructor = globalThis.EventSource;
    const source =
      EventSourceConstructor === undefined
        ? undefined
        : new EventSourceConstructor("/api/v1/events");
    const onInvalidated = (event: Event): void => {
      if (!(event instanceof MessageEvent)) {
        return;
      }
      try {
        const data: unknown = JSON.parse(String(event.data));
        if (
          !deleted.current &&
          typeof data === "object" &&
          data !== null &&
          "sessionId" in data &&
          data.sessionId === sessionId
        ) {
          revalidateRoute();
        }
      } catch {
        // Reconnect/focus recovery will refetch canonical state.
      }
    };
    const onDeleted = (event: Event): void => {
      if (deleted.current || !(event instanceof MessageEvent)) return;
      try {
        const data: unknown = JSON.parse(String(event.data));
        if (
          typeof data === "object" &&
          data !== null &&
          "sectionId" in data &&
          data.sectionId === sectionId
        ) {
          deleted.current = true;
          onSectionDeleted();
        }
      } catch {
        // Invalid events are ignored; canonical state remains unchanged.
      }
    };
    source?.addEventListener("review-invalidated", onInvalidated);
    source?.addEventListener("section-deleted", onDeleted);

    return () => {
      window.removeEventListener("online", requestRevalidation);
      window.removeEventListener("focus", requestRevalidation);
      document.removeEventListener("visibilitychange", onVisibility);
      source?.removeEventListener("review-invalidated", onInvalidated);
      source?.removeEventListener("section-deleted", onDeleted);
      source?.close();
    };
  }, [disabled, onSectionDeleted, revalidateRoute, sectionId, sessionId]);
}
