import { useEffect, useRef, useState } from "react";
import type { ToolCall } from "../../hooks/useApi";
import { MarkdownContent } from "../MarkdownContent";

export function ExitPlanModeToolDiff({
  tool,
  onOpenModal,
}: {
  tool: ToolCall;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  let summary = "";
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  try {
    const parsed = JSON.parse(tool.input);
    summary = parsed.summary || "";
  } catch {
    /* ignore */
  }

  const feedback = tool.output || "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/[0.03] overflow-hidden mb-3 relative group">
      <div className="px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/[0.06] text-[11px] font-mono text-gh-text-secondary flex items-center gap-2">
        <svg className="size-3.5 text-amber-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 5.5a1 1 0 1 1 2 0v3a1 1 0 1 1-2 0v-3Zm1 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
        <span className="font-medium text-gh-text">Proposed Plan</span>
      </div>
      {summary && (
        <div className="px-3 py-2">
          <MarkdownContent
            content={summary}
            className="markdown-body--wide"
            onOpenModal={onOpenModal ? () => onOpenModal(summary, "Proposed Plan") : undefined}
          />
        </div>
      )}
      {summary && (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-1 right-1 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-all opacity-0 group-hover:opacity-100 border border-gh-border bg-surface-elevated"
          title="Copy plan"
        >
          {copied ? (
            <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
          ) : (
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
            </svg>
          )}
        </button>
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
