import { Search, X } from "lucide-react";
import type { Tag } from "../../hooks/types";
import { tagColor, hasTagColor } from "../../utils/tagColors";

interface TagFilterBarProps {
  search: string;
  searchActive: boolean;
  filterTag: string | null;
  filteredTag?: Tag;
  onSearchChange: (value: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onClearFilter: () => void;
}

export function TagFilterBar({
  search,
  searchActive,
  filterTag,
  filteredTag,
  onSearchChange,
  onSearchKeyDown,
  onSearchOpen,
  onSearchClose,
  onClearFilter,
}: TagFilterBarProps) {
  if (!searchActive && !filterTag) {
    return (
      <button
        type="button"
        onClick={onSearchOpen}
        className="flex items-center gap-1 text-[11px] text-ov-text-secondary hover:text-ov-text cursor-pointer w-full px-1 py-0.5 transition-colors"
      >
        <Search size={12} />
        <span>{filterTag ? `Filtered: ${filterTag}` : "Filter tags..."}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 border border-ov-border rounded bg-surface-elevated px-1.5 py-1">
      {filterTag ? (
        <>
          <span
            className="flex items-center gap-1 text-xs text-ov-text truncate flex-1"
            title={`Showing tag "${filterTag}"`}
          >
            {hasTagColor(filteredTag?.color) ? (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tagColor(filteredTag!.color) }}
              />
            ) : (
              <span className="w-2 h-2 shrink-0" />
            )}
            <span className="truncate">{filterTag}</span>
          </span>
          <button
            type="button"
            onClick={onClearFilter}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer shrink-0 p-0.5"
            title="Clear tag filter"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <>
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Filter tags..."
            className="flex-1 text-xs bg-transparent text-ov-text placeholder:text-ov-text-secondary outline-none min-w-0"
          />
          <button
            type="button"
            onClick={onSearchClose}
            className="text-ov-text-secondary hover:text-ov-text cursor-pointer shrink-0 p-0.5"
            title="Close search"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
}
