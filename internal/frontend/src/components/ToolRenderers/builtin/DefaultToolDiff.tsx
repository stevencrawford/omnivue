import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { effectiveToolKind, getToolSummary } from "../../../utils/toolDisplay";
import { CopyButton } from "../../CopyButton";

function ToolDataBlock({ label, content }: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 500;
  const displayContent = !expanded && isLong ? content.slice(0, 500) + "..." : content;

  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted =
        !expanded && isLong
          ? JSON.stringify(parsed, null, 2).slice(0, 500) + "..."
          : JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        {isLong && (
          <span className="text-[10px] text-gh-text-secondary/60">
            (
            {content.length > 1024
              ? `${(content.length / 1024).toFixed(1)}kb`
              : `${content.length}b`}
            )
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          <CopyButton text={content} />
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}

export function DefaultToolDiff({ tool, compact }: ToolRendererProps) {
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="text-gh-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="text-gh-text truncate min-w-0">{summary}</span>
      </div>
    );
  }

  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="font-medium text-gh-text truncate min-w-0">{summary}</span>
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
          {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
        </div>
      )}
    </div>
  );
}
