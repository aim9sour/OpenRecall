import { registerSW } from "virtual:pwa-register";
import {
  createServiceWorkerUpdateController,
  inactiveServiceWorkerUpdateController,
  type ServiceWorkerUpdateController,
} from "./register-service-worker.js";

export function registerOpenRecallServiceWorker(): ServiceWorkerUpdateController {
  if (!("serviceWorker" in navigator)) {
    return inactiveServiceWorkerUpdateController;
  }
  return createServiceWorkerUpdateController(registerSW);
}
