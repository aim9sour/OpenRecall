export interface ReviewInvalidationEvent {
  readonly event: "review-invalidated";
  readonly data: {
    readonly sessionId: string;
    readonly revision: number;
  };
}

export interface SectionDeletedEvent {
  readonly event: "section-deleted";
  readonly data: {
    readonly sectionId: string;
  };
}

export type ReviewEvent =
  | ReviewInvalidationEvent
  | SectionDeletedEvent;

export interface ReviewEventSubscriber {
  send(event: ReviewEvent): Promise<void>;
  close(): void;
}

function canonicalEvent(
  event: ReviewEvent,
): ReviewEvent {
  if (event.event === "review-invalidated") {
    if (
      typeof event.data !== "object" ||
      event.data === null ||
      typeof event.data.sessionId !== "string" ||
      event.data.sessionId.length === 0 ||
      !Number.isSafeInteger(event.data.revision) ||
      event.data.revision < 0
    ) {
      throw new Error("REVIEW_INVALIDATION_EVENT_INVALID");
    }
    return {
      event: "review-invalidated",
      data: {
        sessionId: event.data.sessionId,
        revision: event.data.revision,
      },
    };
  }
  if (event.event === "section-deleted") {
    if (
      typeof event.data !== "object" ||
      event.data === null ||
      typeof event.data.sectionId !== "string" ||
      event.data.sectionId.length === 0
    ) {
      throw new Error("SECTION_DELETED_EVENT_INVALID");
    }
    return {
      event: "section-deleted",
      data: { sectionId: event.data.sectionId },
    };
  }
  throw new Error("REVIEW_EVENT_INVALID");
}

export class ReviewEvents {
  readonly #subscribers = new Set<ReviewEventSubscriber>();

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  subscribe(subscriber: ReviewEventSubscriber): () => void {
    this.#subscribers.add(subscriber);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#subscribers.delete(subscriber);
    };
  }

  publish(event: ReviewEvent): void {
    const safeEvent = canonicalEvent(event);
    for (const subscriber of this.#subscribers) {
      const detach = () => {
        this.#subscribers.delete(subscriber);
        try {
          subscriber.close();
        } catch {
          // The failed transport is already detached.
        }
      };
      try {
        void subscriber.send(safeEvent).catch(detach);
      } catch {
        detach();
      }
    }
  }

  closeAll(): void {
    const subscribers = [...this.#subscribers];
    this.#subscribers.clear();
    for (const subscriber of subscribers) {
      try {
        subscriber.close();
      } catch {
        // Continue closing every remaining transport.
      }
    }
  }
}
