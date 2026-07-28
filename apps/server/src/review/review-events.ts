export interface ReviewInvalidationEvent {
  readonly event: "review-invalidated";
  readonly data: {
    readonly sessionId: string;
    readonly revision: number;
  };
}

export interface ReviewEventSubscriber {
  send(event: ReviewInvalidationEvent): Promise<void>;
  close(): void;
}

function canonicalEvent(
  event: ReviewInvalidationEvent,
): ReviewInvalidationEvent {
  if (
    event.event !== "review-invalidated" ||
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

  publish(event: ReviewInvalidationEvent): void {
    const safeEvent = canonicalEvent(event);
    for (const subscriber of this.#subscribers) {
      void subscriber.send(safeEvent).catch(() => {
        this.#subscribers.delete(subscriber);
        try {
          subscriber.close();
        } catch {
          // The failed transport is already detached.
        }
      });
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
