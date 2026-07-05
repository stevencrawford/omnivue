import { useEffect, useState } from "react";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastProps {
  message: string;
  action?: ToastAction;
  visible: boolean;
  onHide: () => void;
  durationMs?: number;
}

export function Toast({ message, action, visible, onHide, durationMs = 8000 }: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onHide();
      }, durationMs);
      return () => clearTimeout(timer);
    }
    setShow(false);
  }, [visible, onHide, durationMs]);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-slide-up">
      <div className="flex items-center gap-3 bg-surface-elevated text-ov-text text-xs px-4 py-2 rounded-lg shadow-xl border border-accent-border max-w-md">
        <span className="whitespace-normal break-words flex-1">{message}</span>
        {action && (
          <button
            type="button"
            onClick={() => {
              action.onClick();
              onHide();
            }}
            className="shrink-0 px-2 py-0.5 rounded border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 cursor-pointer transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
