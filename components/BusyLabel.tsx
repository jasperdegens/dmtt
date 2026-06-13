import type { ReactNode } from "react";

export function BusyLabel({ children }: { children: ReactNode }) {
  return (
    <span className="btn-busy">
      <span>{children}</span>
      <span className="bounce-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
