import { BrainCircuit } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";
import { ToolActionsBar } from "../ToolActionsBar";

const SCOPE_COLORS: Record<string, string> = {
  user: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  repo: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  session: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

function scopeBadge(scope: string): string {
  const classes = SCOPE_COLORS[scope] || "bg-violet-500/10 text-violet-400 border-violet-500/30";
  return `<span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border uppercase tracking-wider ${classes}">${scope}</span>`;
}

export function StoreMemoryToolDiff({
  tool,
  variant,
  onPin,
  onBookmark,
  isBookmarked,
}: ToolRendererProps) {
  let subject = "";
  let fact = "";
  let citations = "";
  let reason = "";
  let scope = "";

  try {
    const parsed = JSON.parse(tool.input);
    subject = parsed.subject || "";
    fact = parsed.fact || "";
    citations = parsed.citations || "";
    reason = parsed.reason || "";
    scope = parsed.scope || "";
  } catch {
    /* ignore */
  }

  const outputLabel = tool.output && !tool.output.startsWith("{") ? tool.output : "";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <BrainCircuit size={14} className="text-violet-400 shrink-0" />
        <span className="text-violet-400 font-semibold shrink-0">Memory:</span>
        <span className="text-ov-text-secondary truncate min-w-0">
          {subject.slice(0, 80) || "store_memory"}
        </span>
        {scope && <span dangerouslySetInnerHTML={{ __html: scopeBadge(scope) }} />}
      </div>
    );
  }

  const scopeClasses =
    SCOPE_COLORS[scope] || "bg-violet-500/10 text-violet-400 border-violet-500/30";

  return (
    <div className="border border-violet-500/30 rounded-lg overflow-hidden bg-violet-500/[0.04] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <BrainCircuit size={22} className="text-violet-400 shrink-0" />
          <span className="font-semibold text-[13px] text-violet-400">Store Memory</span>
          {scope && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border uppercase tracking-wider ${scopeClasses}`}
            >
              {scope}
            </span>
          )}
          <div className="ml-auto flex items-center">
            <ToolActionsBar
              tool={tool}
              onPin={onPin}
              onBookmark={onBookmark}
              isBookmarked={isBookmarked}
              showPin
            />
          </div>
        </div>

        {subject && <h4 className="mt-2.5 text-[13px] font-semibold text-ov-text">{subject}</h4>}

        {fact && (
          <div className="mt-1.5 text-[13px]">
            <div className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">
              <MarkdownContent content={fact} className="markdown-body--wide" />
            </div>
          </div>
        )}

        {reason && (
          <details className="mt-2 group">
            <summary className="text-[11px] font-semibold text-ov-text-secondary/60 cursor-pointer hover:text-ov-text-secondary list-none flex items-center gap-1.5 select-none">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform group-open:rotate-90"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Why
            </summary>
            <div className="mt-1.5 pl-2 border-l-2 border-violet-500/20">
              <p className="text-[12px] text-ov-text-secondary/70 leading-relaxed">{reason}</p>
            </div>
          </details>
        )}

        {citations && (
          <p className="mt-2 text-[11px] text-ov-text-secondary/40 italic leading-relaxed">
            {citations}
          </p>
        )}

        {outputLabel && !fact && (
          <div className="mt-2 text-[13px]">
            <MarkdownContent content={outputLabel} className="markdown-body--wide" />
          </div>
        )}
      </div>
    </div>
  );
}
