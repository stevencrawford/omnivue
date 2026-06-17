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
  const offset = input.offset ?? 1;
  const limit = input.limit ?? 0;
  const showLineRange = limit > 0;

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^[0-9]{5}\| ?/gm, "");

  const baseName = filePath.split("/").pop() || filePath;

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`size-3 text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="text-gh-text-secondary/70 font-medium shrink-0">read:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {showLineRange && (
          <span className="text-gh-text-secondary/70 shrink-0">
            :{offset}-{offset + limit}
          </span>
        )}
      </button>
      {expanded && cleanContent && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
          {cleanContent}
        </pre>
      )}
    </div>
  );
}
