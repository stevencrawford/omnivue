import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
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

  return <GrepCard pattern={pattern} scope={scope} matchCount={matchCount} results={results} />;
}

function GrepCard({
  pattern,
  scope,
  matchCount,
  results,
}: {
  pattern: string;
  scope: string;
  matchCount: number;
  results: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-violet-500/20 rounded overflow-hidden bg-violet-500/[0.04] min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] cursor-pointer hover:bg-violet-500/10 transition-colors min-w-0"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={`text-violet-300/70 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Search size={12} className="text-violet-400 shrink-0" />
        <span className="text-violet-300/70 shrink-0">grep:</span>
        <span
          className="text-ov-text font-medium truncate min-w-0 text-left"
          title={pattern || "search"}
        >
          {pattern || "search"}
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
          <span className="ml-auto shrink-0 text-[10px] text-violet-300/60 tabular-nums">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-violet-500/15 bg-violet-500/[0.03] max-h-60 overflow-y-auto overflow-x-hidden">
          {results ? (
            <pre className="text-[11px] font-mono leading-relaxed text-ov-text whitespace-pre-wrap break-all min-w-0">
              {results}
            </pre>
          ) : (
            <p className="text-[11px] text-ov-text-secondary/60 italic">No matches</p>
          )}
        </div>
      )}
    </div>
  );
}
