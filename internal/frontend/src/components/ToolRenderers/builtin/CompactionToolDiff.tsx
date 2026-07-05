import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";
import { ToolActionsBar } from "../ToolActionsBar";

interface CompactionInput {
  kind?: string;
  count?: number;
  label?: string;
}

export function CompactionToolDiff({
  tool,
  variant,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
}: ToolRendererProps) {
  let input: CompactionInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const [expanded, setExpanded] = useState(false);
  const content = tool.output ?? "";
  const hasContent = content.length > 0;
  const label = input.label || input.kind || "Compaction";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="text-gray-400 font-semibold shrink-0">{label}</span>
      </div>
    );
  }

  return (
    <div className="border border-gray-500/30 rounded-lg overflow-hidden bg-gray-500/[0.04] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-ov-border" />
          <div className="flex items-center gap-1">
            {hasContent ? (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-[10px] font-medium text-ov-text-secondary/50 uppercase tracking-wider whitespace-nowrap hover:text-ov-text-secondary transition-colors cursor-pointer"
              >
                {label}
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            ) : (
              <span className="text-[10px] font-medium text-ov-text-secondary/50 uppercase tracking-wider whitespace-nowrap select-none">
                {label}
              </span>
            )}
          </div>
          <div className="flex-1 h-px bg-ov-border" />
        </div>

        <div className="flex justify-end mt-1">
          <ToolActionsBar
            tool={tool}
            onPin={onPin}
            onBookmark={onBookmark}
            isBookmarked={isBookmarked}
            childSessionId={childSessionId}
            navigateToSession={navigateToSession}
            showPin
          />
        </div>

        {expanded && hasContent && (
          <div className="mt-3 pt-3 border-t border-gray-500/20">
            <MarkdownContent content={content} className="markdown-body--wide" />
          </div>
        )}
      </div>
    </div>
  );
}
