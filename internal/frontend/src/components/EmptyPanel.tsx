import type { ReactNode } from "react";

interface EmptyPanelProps {
  icon: ReactNode;
  title: string;
  hint?: ReactNode;
}

export function EmptyPanel({ icon, title, hint }: EmptyPanelProps) {
  return (
    <div className="sess-empty-state p-8 h-full">
      <div className="sess-empty-icon">{icon}</div>
      <p className="text-sm text-ov-text-secondary">{title}</p>
      {hint && <p className="text-xs text-ov-text-secondary/70 max-w-xs text-center">{hint}</p>}
    </div>
  );
}
