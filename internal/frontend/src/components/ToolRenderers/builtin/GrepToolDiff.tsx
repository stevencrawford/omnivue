import { Search } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface GrepInput {
  pattern?: string;
  query?: string;
  path?: string;
  include?: string;
}

export function GrepToolDiff({
  tool,
  compact,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let input: GrepInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let matchCount = 0;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    matchCount = meta.matches ?? 0;
  } catch {
    /* ignore */
  }

  const pattern = input.pattern || input.query || "";
  const results = tool.output || "";

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Search size={12} className="text-violet-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">grep:</span>
        <span className="text-gh-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {matchCount > 0 && (
          <span className="shrink-0 text-gh-text-secondary ml-auto">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
      </div>
    );
  }

  return results ? (
    <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
      {results}
    </pre>
  ) : null;
}
