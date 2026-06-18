import { useEffect, useRef } from "react";

interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();

    let x = position.x;
    let y = position.y;

    if (x + rect.width > innerWidth - 8) x = innerWidth - rect.width - 8;
    if (y + rect.height > innerHeight - 8) y = innerHeight - rect.height - 8;

    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  }, [position]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const scrollHandler = () => onClose();

    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    document.addEventListener("scroll", scrollHandler, true);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
      document.removeEventListener("scroll", scrollHandler, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[100] min-w-[160px] bg-surface-elevated border border-gh-border rounded-lg shadow-xl py-1"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {item.icon && <span className="size-3.5 shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}
