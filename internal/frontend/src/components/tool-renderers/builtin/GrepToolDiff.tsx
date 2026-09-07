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
  variant,
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
  const scope = [input.path, input.include].filter(Boolean).join(" · ");
  const results = tool.output || "";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Search size={12} className="text-violet-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">grep:</span>
        <span className="text-ov-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {matchCount > 0 && (
          <span className="shrink-0 text-ov-text-secondary ml-auto">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
      </div>
    );
  }

  if (!pattern && !results) return null;

  return (
    <div className="px-3 py-2 space-y-2">
      {pattern && (
        <div className="flex items-center gap-2 min-w-0">
          <Search size={14} className="text-violet-400 shrink-0" />
          <span
            className="text-[11px] font-mono font-semibold text-ov-text truncate min-w-0"
            title={pattern}
          >
            {pattern}
          </span>
          {scope && (
            <span
              className="text-[10px] font-mono text-ov-text-secondary/60 truncate min-w-0"
              title={scope}
            >
              {scope}
            </span>
          )}
          {matchCount > 0 && (
            <span className="ml-auto shrink-0 text-[10px] text-ov-text-secondary/60 tabular-nums">
              {matchCount} match{matchCount === 1 ? "" : "es"}
            </span>
          )}
        </div>
      )}
      {results && (
        <div className="bg-ov-bg-hover rounded border border-ov-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-ov-border bg-ov-bg/50">
            <span className="text-[10px] font-semibold text-ov-text-secondary uppercase tracking-wider">
              Results
            </span>
          </div>
          <pre className="p-2.5 text-[11px] font-mono leading-relaxed text-ov-text whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {results}
          </pre>
        </div>
      )}
    </div>
  );
}
