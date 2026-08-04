import { ArrowUpDown, Minus, Plus } from "lucide-react";

export type TagSort = "name" | "count";

interface TagListHeaderProps {
  allExpanded: boolean;
  tagSort: TagSort;
  sortOpen: boolean;
  sortRef: React.RefObject<HTMLDivElement | null>;
  onToggleSort: () => void;
  onSortSelect: (mode: TagSort) => void;
  onToggleAll: () => void;
  onNewTag: () => void;
}

const SORT_MODES: TagSort[] = ["name", "count"];

export function TagListHeader({
  allExpanded,
  tagSort,
  sortOpen,
  sortRef,
  onToggleSort,
  onSortSelect,
  onToggleAll,
  onNewTag,
}: TagListHeaderProps) {
  return (
    <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
        Tags
      </span>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleAll}
          className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
          title={allExpanded ? "Collapse all" : "Expand all"}
        >
          {allExpanded ? <Minus size={14} /> : <Plus size={14} />}
        </button>
        <div className="relative" ref={sortRef}>
          <button
            type="button"
            onClick={onToggleSort}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
            title="Sort tags"
          >
            <ArrowUpDown size={14} />
          </button>
          {sortOpen && (
            <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
              {SORT_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                    tagSort === mode
                      ? "sess-session-active"
                      : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
                  }`}
                  onClick={() => onSortSelect(mode)}
                >
                  {mode === "name" ? "Name" : "Count"}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onNewTag}
          className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
          title="New tag"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
