import { useState } from "react";
import { Copy, Check, Pin, ArrowRight as ArrowRightIcon, Bookmark } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";

function CopyOutputBtn({ tool }: { tool: ToolCall }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(tool.output || "");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
      title="Copy output"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

export function ToolActionsBar({
  tool,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
  showPin,
}: {
  tool: ToolCall;
  onPin?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  childSessionId?: string | null;
  navigateToSession?: (id: string) => void;
  showPin?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {showPin && tool.output && onPin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPin(tool.output!);
          }}
          className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
          title="Pin as scratch note"
        >
          <Pin size={12} />
        </button>
      )}
      {childSessionId && navigateToSession && (
        <button
          type="button"
          className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-ov-bg-hover cursor-pointer transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            navigateToSession(childSessionId);
          }}
        >
          <ArrowRightIcon size={12} className="inline" /> View session
        </button>
      )}
      <CopyOutputBtn tool={tool} />
      {onBookmark && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBookmark();
          }}
          className={`size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0 ${isBookmarked ? "text-accent" : ""}`}
          title={isBookmarked ? "Remove bookmark" : "Bookmark"}
        >
          <Bookmark size={12} fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}
