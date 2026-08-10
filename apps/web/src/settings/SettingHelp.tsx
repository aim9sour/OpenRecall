import type { ReactNode } from "react";

export function SettingHelp({ children, label }: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return <details className="setting-help"><summary>{label}</summary><div>{children}</div></details>;
}
