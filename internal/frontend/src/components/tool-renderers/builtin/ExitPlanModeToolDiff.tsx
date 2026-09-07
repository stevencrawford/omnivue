import { FileText } from "lucide-react";
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

export function ExitPlanModeToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let summary = "";

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const feedback = tool.output || "";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <FileText size={12} className="text-amber-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">plan:</span>
        <span className="text-ov-text truncate min-w-0">
          {summary ? summary.split("\n")[0].slice(0, 80) : "Proposed Plan"}
        </span>
      </div>
    );
  }

  const isMarkdown = summary ? looksLikeMarkdown(summary) : false;

  return (
    <div className="px-3 py-2 space-y-2">
      {summary && (
        <div className="text-[12px]">
          {isMarkdown ? (
            <MarkdownContent content={summary} className="markdown-body--wide" hideCopy />
          ) : (
            <p className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">{summary}</p>
          )}
        </div>
      )}
      {feedback && (
        <div className="pt-2 border-t border-ov-border">
          <div className="text-[11px] font-semibold text-ov-text-secondary/60 uppercase tracking-wider mb-1">
            Response
          </div>
          <div className="text-[11px] text-ov-text-secondary pl-2 border-l-2 border-amber-400/40 whitespace-pre-wrap leading-relaxed">
            {feedback}
          </div>
        </div>
      )}
    </div>
  );
}
