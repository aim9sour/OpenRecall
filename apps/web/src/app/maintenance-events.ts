export const MAINTENANCE_NAVIGATION_START =
  "openrecall:maintenance-navigation-start";
export const MAINTENANCE_NAVIGATION_END =
  "openrecall:maintenance-navigation-end";

export function beginMaintenanceNavigationBlock(): void {
  window.dispatchEvent(new Event(MAINTENANCE_NAVIGATION_START));
}

export function endMaintenanceNavigationBlock(): void {
  window.dispatchEvent(new Event(MAINTENANCE_NAVIGATION_END));
}
