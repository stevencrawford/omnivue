import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl" | "full";
  className?: string;
}

const SIZE_MAP: Record<string, string> = {
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-7xl",
  full: "max-w-[90vw]",
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "xl",
  className = "",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]">
      <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40" onClick={onClose} />
      <div
        ref={panelRef}
        className={`relative z-50 flex flex-col rounded-xl border border-accent-border bg-surface-elevated shadow-2xl w-full ${SIZE_MAP[size]} max-h-[80vh] overflow-hidden ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gh-border shrink-0">
            <h2 className="text-sm font-semibold text-gh-text truncate">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-gh-text-secondary hover:text-gh-text cursor-pointer p-1 rounded transition-colors"
            >
              <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
        )}
        <div className={`flex-1 overflow-y-auto p-5 ${className}`}>{children}</div>
      </div>
    </div>
  );
}
