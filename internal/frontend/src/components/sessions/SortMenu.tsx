import type { SortMode } from "../../utils/buildTree";

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
  "cost-asc": "Cost ↑",
  "cost-desc": "Cost ↓",
};

interface SortMenuProps {
  open: boolean;
  sortMode: SortMode;
  onSelect: (mode: SortMode) => void;
}

export function SortMenu({ open, sortMode, onSelect }: SortMenuProps) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
      {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
            sortMode === mode
              ? "text-ov-text bg-ov-bg-active"
              : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
          }`}
          onClick={() => onSelect(mode)}
        >
          {SORT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
