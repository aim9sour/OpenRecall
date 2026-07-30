import { describe, expect, it, vi } from "vitest";
import { createServiceWorkerUpdateController } from "./register-service-worker.js";

describe("service worker update controller", () => {
  it("exposes refresh/offline events and activates only on request", async () => {
    let callbacks:
      | {
          onNeedRefresh?: () => void;
          onOfflineReady?: () => void;
        }
      | undefined;
    const activate = vi.fn(async () => undefined);
    const controller = createServiceWorkerUpdateController(
      (options) => {
        callbacks = options;
        return activate;
      },
    );

    expect(controller.getSnapshot()).toEqual({
      needRefresh: false,
      offlineReady: false,
    });
    callbacks?.onOfflineReady?.();
    expect(controller.getSnapshot().offlineReady).toBe(true);
    controller.deferUpdate();
    expect(controller.getSnapshot().offlineReady).toBe(false);

    callbacks?.onNeedRefresh?.();
    expect(controller.getSnapshot().needRefresh).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    await controller.requestUpdate();
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(true);
  });
});
