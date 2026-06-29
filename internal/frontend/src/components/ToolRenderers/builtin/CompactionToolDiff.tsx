import type { ToolRendererProps } from "../types";

interface CompactionInput {
  kind?: string;
  count?: number;
  label?: string;
}

export function CompactionToolDiff({
  tool,
  compact: _compact,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let input: CompactionInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const count = input.count ?? 0;
  const label = input.label || input.kind || "items";

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 select-none">
      <div className="flex-1 h-px bg-gh-border" />
      <span className="text-[10px] font-medium text-gh-text-secondary/50 uppercase tracking-wider whitespace-nowrap shrink-0">
        {count} {label}
      </span>
      <div className="flex-1 h-px bg-gh-border" />
    </div>
  );
}
