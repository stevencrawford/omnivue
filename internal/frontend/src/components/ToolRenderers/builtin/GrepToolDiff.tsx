import { Search } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { CopyButton } from "../../CopyButton";
import { BookmarkButton } from "../BookmarkButton";

interface GrepInput {
  pattern?: string;
  query?: string;
  path?: string;
  include?: string;
}

export function GrepToolDiff({ tool, compact, onCopy, onBookmark, isBookmarked }: ToolRendererProps) {
  let input: GrepInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let matchCount = 0;
  let truncated = false;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    matchCount = meta.matches ?? 0;
    truncated = !!meta.truncated;
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

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <Search size={12} className="text-violet-400 shrink-0" />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">grep:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {matchCount > 0 && (
          <span className="shrink-0 text-gh-text-secondary">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">truncated</span>}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />}
        </div>
      </div>
      {results && (
        <div className="relative group">
          <CopyButton text={results} className="absolute top-1 right-1 z-10" />
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {results}
          </pre>
        </div>
      )}
    </div>
  );
}
