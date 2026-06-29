import { CircleAlert } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";
import { BookmarkButton } from "../BookmarkButton";

export function ExitPlanModeToolDiff({ tool, compact, onOpenModal, onPin, onBookmark, isBookmarked }: ToolRendererProps) {
  let summary = "";

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const feedback = tool.output || "";

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleAlert size={12} className="text-amber-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">plan:</span>
        <span className="text-gh-text truncate min-w-0">
          {summary ? summary.split("\n")[0].slice(0, 80) : "Proposed Plan"}
        </span>
      </div>
    );
  }

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/[0.03] overflow-hidden mb-3 relative group">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/[0.06] text-[11px] font-mono text-gh-text-secondary">
        <CircleAlert size={14} className="text-amber-400 shrink-0" />
        <span className="font-medium text-gh-text">Proposed Plan</span>
        <div className="ml-auto flex items-center gap-1">
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />}
        </div>
      </div>
      {summary && (
        <div className="px-3 py-2">
          <MarkdownContent
            content={summary}
            className="markdown-body--wide"
            onOpenModal={onOpenModal ? () => onOpenModal(summary, "Proposed Plan") : undefined}
            onPin={onPin ? () => onPin(summary) : undefined}
          />
        </div>
      )}
      {feedback && (
        <div className="border-t border-amber-500/20 px-3 py-2">
          <div className="text-[11px] font-semibold text-gh-text-secondary mb-1">USER-RESPONSE</div>
          <div className="text-[11px] text-gh-text pl-2 border-l-2 border-amber-400/40 whitespace-pre-wrap leading-relaxed">
            {feedback}
          </div>
        </div>
      )}
    </div>
  );
}
