export interface ServiceWorkerUpdateSnapshot {
  readonly needRefresh: boolean;
  readonly offlineReady: boolean;
}

export interface ServiceWorkerRegistrationCallbacks {
  readonly onNeedRefresh?: () => void;
  readonly onOfflineReady?: () => void;
}

export type ServiceWorkerUpdateFunction = (
  reloadPage?: boolean,
) => Promise<void>;

export type ServiceWorkerRegisterFunction = (
  callbacks: ServiceWorkerRegistrationCallbacks,
) => ServiceWorkerUpdateFunction;

export interface ServiceWorkerUpdateController {
  readonly getSnapshot: () => ServiceWorkerUpdateSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly deferUpdate: () => void;
  readonly requestUpdate: () => Promise<void>;
}

const inactiveSnapshot: ServiceWorkerUpdateSnapshot = Object.freeze({
  needRefresh: false,
  offlineReady: false,
});

export function createServiceWorkerUpdateController(
  register: ServiceWorkerRegisterFunction,
): ServiceWorkerUpdateController {
  let snapshot = inactiveSnapshot;
  const listeners = new Set<() => void>();

  const updateSnapshot = (
    next: ServiceWorkerUpdateSnapshot,
  ): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const activate = register({
    onNeedRefresh: () => {
      updateSnapshot({
        ...snapshot,
        needRefresh: true,
      });
    },
    onOfflineReady: () => {
      updateSnapshot({
        ...snapshot,
        offlineReady: true,
      });
    },
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    deferUpdate: () => updateSnapshot(inactiveSnapshot),
    requestUpdate: async () => {
      if (!snapshot.needRefresh) return;
      await activate(true);
      updateSnapshot(inactiveSnapshot);
    },
  };
}

export const inactiveServiceWorkerUpdateController =
  createServiceWorkerUpdateController(() => async () => undefined);
