import { CircleAlert } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

export function ExitPlanModeToolDiff({
  tool,
  compact,
  onOpenModal,
  onPin,
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
    <>
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
    </>
  );
}
