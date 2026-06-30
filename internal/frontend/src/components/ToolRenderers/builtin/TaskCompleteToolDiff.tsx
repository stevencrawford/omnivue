import { CircleCheckBig } from "lucide-react";
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

export function TaskCompleteToolDiff({ tool, compact }: ToolRendererProps) {
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

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleCheckBig size={12} className="text-emerald-400 shrink-0" />
        <span className="text-emerald-400 font-semibold shrink-0">Task Complete</span>
        {(summary || outputLabel) && (
          <span className="text-ov-text-secondary truncate min-w-0">
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
    <div className="border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.04] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CircleCheckBig size={20} className="text-emerald-400 shrink-0" />
          <span className="font-semibold text-[13px] text-emerald-400">Task Complete</span>
          {displayDuration > 0 && (
            <span className="text-[11px] text-ov-text-secondary/50 ml-auto">
              {(displayDuration / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {summary && (
          <div className="mt-2 text-[13px]">
            {isMarkdown ? (
              <MarkdownContent content={summary} className="markdown-body--wide" />
            ) : (
              <p className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">
                {summary}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
