import { CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../ui/MarkdownContent";

function looksLikeMarkdown(text: string): boolean {
  return (
    /#{1,6}\s/.test(text) ||
    /\[.+\]\(.+\)/.test(text) ||
    /(?:^|\n)[-*+]\s/.test(text) ||
    /(?:^|\n)\d+\.\s/.test(text) ||
    /(?:^|\n)>\s/.test(text) ||
    /(?:^|\n)-{3,}/.test(text) ||
    /`{3}/.test(text) ||
    /\|.+\|/.test(text) ||
    /[*_]{2,}.+[*_]{2,}/.test(text)
  );
}

export function TaskCompleteToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let summary = "";
  let durationMs = 0;

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
    durationMs = parsed.duration_ms || 0;
  } catch {
    /* ignore */
  }

  const displayDuration = tool.duration ?? durationMs;

  const outputLabel = tool.output && tool.output !== "completed" ? tool.output : "";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleCheckBig size={12} className="text-emerald-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">task_complete:</span>
        {(summary || outputLabel) && (
          <span className="text-ov-text truncate min-w-0">
            {(summary ? summary.split("\n")[0] : outputLabel).slice(0, 80)}
          </span>
        )}
        {displayDuration > 0 && (
          <span className="text-[11px] text-ov-text-secondary/40 shrink-0">
            {(displayDuration / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    );
  }

  const isMarkdown = summary ? looksLikeMarkdown(summary) : false;

  return (
    <div className="px-3 py-2 space-y-2">
      {displayDuration > 0 && (
        <span className="text-[11px] text-ov-text-secondary/50">
          {(displayDuration / 1000).toFixed(1)}s
        </span>
      )}
      {summary && (
        <div className="text-[12px]">
          {isMarkdown ? (
            <MarkdownContent content={summary} className="markdown-body--wide" />
          ) : (
            <p className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">{summary}</p>
          )}
        </div>
      )}
      {outputLabel && !summary && (
        <div className="text-[12px]">
          <MarkdownContent content={outputLabel} className="markdown-body--wide" />
        </div>
      )}
    </div>
  );
}
