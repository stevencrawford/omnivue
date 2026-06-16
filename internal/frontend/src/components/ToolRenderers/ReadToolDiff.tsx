import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";

interface ReadInput {
  filePath?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

export function ReadToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let input: ReadInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const isPartialRead = (input.offset ?? 0) > 0 || (input.limit ?? 0) > 0;

  let truncated = false;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    truncated = !!meta.truncated;
  } catch {
    /* ignore */
  }

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^[0-9]{5}\| ?/gm, "");

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${expanded ? "border-b border-accent-border " : ""}bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-gh-text-secondary/70 font-medium">read:</span>
        <span className="font-medium text-gh-text truncate" title={filePath}>
          {filePath}
        </span>
        {isPartialRead && (
          <span className="shrink-0 text-gh-text-secondary/70">
            :{input.offset ?? 1}-{(input.offset ?? 0) + (input.limit ?? 0)}
          </span>
        )}
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">file truncated</span>}
      </button>
      {expanded && cleanContent && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
          {cleanContent}
        </pre>
      )}
    </div>
  );
}
