import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { CopyButton } from "../CopyButton";
import { BookmarkButton } from "./BookmarkButton";

interface GlobInput {
  pattern?: string;
}

export function GlobToolDiff({
  tool,
  onBookmark,
  isBookmarked = false,
}: {
  tool: ToolCall;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  let input: GlobInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let count = 0;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    count = meta.count ?? 0;
  } catch {
    /* ignore */
  }

  const pattern = input.pattern || "";
  const output = tool.output || "";
  if (!count && output) {
    count = output.split("\n").filter(Boolean).length;
  }

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50 group">
      <div
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">glob:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0 text-gh-text-secondary">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
        {onBookmark && (
          <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <BookmarkButton isBookmarked={isBookmarked} onClick={onBookmark} />
          </span>
        )}
      </div>
      {expanded && output && (
        <div className="relative group">
          <CopyButton text={output} className="absolute top-1 right-1 z-10" />
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
