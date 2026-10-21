import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brain, ListFilter, MessageSquare, User as UserIcon, Wrench } from "lucide-react";
import {
  ACTIVITY_KINDS,
  DEFAULT_ACTIVITY_FILTERS,
  isActivityKindVisible,
  type ActivityFilters,
  type ActivityItemKind,
} from "../../utils/activityFilters";

interface ActivityFilterMenuProps {
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
}

const KIND_OPTIONS: Array<{ kind: ActivityItemKind; label: string; icon: ReactNode }> = [
  {
    kind: "user",
    label: "User messages",
    icon: <UserIcon size={12} className="text-blue-400 shrink-0" />,
  },
  {
    kind: "assistant",
    label: "Assistant messages",
    icon: <MessageSquare size={12} className="text-ov-text-secondary shrink-0" />,
  },
  {
    kind: "thinking",
    label: "Thinking",
    icon: <Brain size={12} className="text-violet-400 shrink-0" />,
  },
  {
    kind: "tool",
    label: "Tool calls",
    icon: <Wrench size={12} className="text-accent shrink-0" />,
  },
];

/**
 * Checkbox dropdown controlling which item kinds the activity drawer renders.
 * The selection is an include list; Reset restores every kind. Clicking outside
 * or pressing Escape closes the menu.
 */
export function ActivityFilterMenu({ filters, onChange }: ActivityFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const enabledCount = ACTIVITY_KINDS.filter((kind) => filters[kind]).length;
  const allEnabled = enabledCount === ACTIVITY_KINDS.length;
  const filterLabel = `Filter activity (${enabledCount} of ${ACTIVITY_KINDS.length} types shown)`;

  return (
    <div className="relative shrink-0" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative size-6 flex items-center justify-center rounded cursor-pointer transition-colors hover:bg-ov-bg-hover ${
          allEnabled ? "text-ov-text-secondary hover:text-ov-text" : "text-accent"
        }`}
        title={filterLabel}
        aria-label={filterLabel}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <ListFilter size={14} />
        {!allEnabled && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent" />}
      </button>
      {open && (
        <div
          role="group"
          aria-label="Activity filters"
          className="absolute right-0 top-full mt-1 w-52 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-30 py-1"
        >
          <div className="flex items-center gap-2 px-2.5 py-1 mb-1 border-b border-ov-border">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ov-text-secondary">
              Activity types
            </span>
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_ACTIVITY_FILTERS })}
              disabled={allEnabled}
              className={`ml-auto text-[11px] transition-colors ${
                allEnabled
                  ? "text-ov-text-secondary/40 cursor-default"
                  : "text-accent hover:text-accent-secondary cursor-pointer"
              }`}
            >
              Reset
            </button>
          </div>
          {KIND_OPTIONS.map(({ kind, label, icon }) => (
            <label
              key={kind}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text cursor-pointer transition-colors select-none"
            >
              <input
                type="checkbox"
                checked={isActivityKindVisible(kind, filters)}
                onChange={() => onChange({ ...filters, [kind]: !filters[kind] })}
                className="size-3 accent-accent cursor-pointer shrink-0"
              />
              {icon}
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
