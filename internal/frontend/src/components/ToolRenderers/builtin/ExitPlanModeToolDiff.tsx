import { FileText } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

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

export function ExitPlanModeToolDiff({ tool, compact }: ToolRendererProps) {
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
        <FileText size={12} className="text-amber-400 shrink-0" />
        <span className="text-amber-400 font-semibold shrink-0">Plan</span>
        <span className="text-gh-text-secondary truncate min-w-0">
          {summary ? summary.split("\n")[0].slice(0, 80) : "Proposed Plan"}
        </span>
      </div>
    );
  }

  const isMarkdown = summary ? looksLikeMarkdown(summary) : false;

  return (
    <div className="border border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/[0.04]">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5 mb-2">
          <FileText size={20} className="text-amber-400 shrink-0" />
          <span className="font-semibold text-[13px] text-amber-400">Plan</span>
        </div>
        {summary && (
          <div className="text-[13px]">
            {isMarkdown ? (
              <MarkdownContent content={summary} className="markdown-body--wide" />
            ) : (
              <p className="text-gh-text-secondary leading-relaxed whitespace-pre-wrap">
                {summary}
              </p>
            )}
          </div>
        )}
        {feedback && (
          <div className="mt-3 pt-3 border-t border-amber-500/20">
            <div className="text-[11px] font-semibold text-gh-text-secondary/60 uppercase tracking-wider mb-1">
              Response
            </div>
            <div className="text-[11px] text-gh-text pl-2 border-l-2 border-amber-400/40 whitespace-pre-wrap leading-relaxed">
              {feedback}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
