import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";

interface EditInput {
  path?: string;
  filePath?: string;
  file_path?: string;
  old_str?: string;
  new_str?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  view_range?: [number, number];
}

export function EditCompactToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let input: EditInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const oldStr = input.old_str || input.oldString || "";
  const newStr = input.new_str || input.newString || "";
  const viewRange = input.view_range;
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
        <span className="text-gh-text-secondary/70 font-medium shrink-0">edit:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {viewRange && (
          <span className="text-gh-text-secondary/70 shrink-0">
            :{viewRange[0]}-{viewRange[1]}
          </span>
        )}
      </button>
      {expanded && (oldStr || newStr) && (
        <div className="border-t border-accent-border px-3 py-2 space-y-2 bg-gh-bg-secondary/50">
          {oldStr && (
            <div>
              <div className="text-[11px] font-semibold text-red-400 mb-1">- old</div>
              <pre className="text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {oldStr}
              </pre>
            </div>
          )}
          {newStr && (
            <div>
              <div className="text-[11px] font-semibold text-green-400 mb-1">+ new</div>
              <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {newStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
