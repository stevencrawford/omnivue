import type { ToolCall } from "../../hooks/useApi";
import { MarkdownContent } from "../MarkdownContent";

export function ExitPlanModeToolDiff({ tool }: { tool: ToolCall }) {
  let summary = "";
  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const feedback = tool.output || "";

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <span className="font-medium text-gh-text">Proposed Plan</span>
      </div>
      {summary && (
        <div className="px-3 py-2">
          <MarkdownContent content={summary} className="markdown-body--wide" />
        </div>
      )}
      {feedback && (
        <div className="border-t border-accent-border px-3 py-2">
          <div className="text-[11px] font-semibold text-gh-text-secondary mb-1">USER-FEEDBACK</div>
          <div className="text-[11px] text-gh-text pl-2 border-l-2 border-gh-border whitespace-pre-wrap leading-relaxed">
            {feedback}
          </div>
        </div>
      )}
    </div>
  );
}
