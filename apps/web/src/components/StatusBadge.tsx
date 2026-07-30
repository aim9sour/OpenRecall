import type { ReactNode } from "react";

export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: StatusTone;
}) {
  return (
    <span className="status-badge" data-tone={tone}>
      {children}
    </span>
  );
}
