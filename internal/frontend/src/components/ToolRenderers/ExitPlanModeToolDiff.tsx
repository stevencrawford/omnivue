import { CircleAlert } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { MarkdownContent } from "../MarkdownContent";
import { CopyButton } from "../CopyButton";

export function ExitPlanModeToolDiff({
  tool,
  onOpenModal,
  onPin,
}: {
  tool: ToolCall;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
}) {
  let summary = "";

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const feedback = tool.output || "";

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/[0.03] overflow-hidden mb-3 relative group">
      <div className="px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/[0.06] text-[11px] font-mono text-gh-text-secondary flex items-center gap-2">
        <CircleAlert size={14} className="text-amber-400 shrink-0" />
        <span className="font-medium text-gh-text">Proposed Plan</span>
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
      {summary && <CopyButton text={summary} className="absolute top-1 right-1 z-10" />}
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
