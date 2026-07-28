import { useEffect } from "react";
import { useRevalidator } from "react-router";

export function useReviewEvents(sessionId: string): void {
  const { revalidate: revalidateRoute } = useRevalidator();

  useEffect(() => {
    const requestRevalidation = (): void => {
      void revalidateRoute();
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
    source?.addEventListener("review-invalidated", onInvalidated);

    return () => {
      window.removeEventListener("online", requestRevalidation);
      window.removeEventListener("focus", requestRevalidation);
      document.removeEventListener("visibilitychange", onVisibility);
      source?.removeEventListener("review-invalidated", onInvalidated);
      source?.close();
    };
  }, [revalidateRoute, sessionId]);
}
