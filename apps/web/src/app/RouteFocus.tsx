import { useEffect } from "react";
import { useLocation } from "react-router";

export function RouteFocus() {
  const { pathname } = useLocation();

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>(
      "h1[data-route-heading]",
    );
    heading?.focus();
  }, [pathname]);

  return null;
}
