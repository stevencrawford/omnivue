import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";
import { detectLanguage } from "../../utils/detectLanguage";
import { computeDiff } from "../../utils/diff";
import { PatchRenderer, FileRenderer } from "../DiffRenderer";

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

export function EditToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 20;
  let input: EditInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const oldStr = input.old_str || input.oldString || "";
  const newStr = input.new_str || input.newString || "";
  const content = input.content || "";
  const viewRange = input.view_range;
  const lang = detectLanguage(filePath);

  const isWrite = tool.name === "write" && !!content;
  const isAddition = (viewRange != null && !oldStr) || isWrite;

  // Skip expensive diff computation for very large files — just show the new content.
  const skipDiff = (oldStr && oldStr.length > 20000) || (newStr && newStr.length > 20000);

  const displayContent = newStr || content;
  const totalLines = displayContent ? displayContent.split("\n").length : 0;
  const isOverLimit = totalLines > MAX_LINES;
  const truncatedContent =
    !expanded && isOverLimit
      ? displayContent.split("\n").slice(0, MAX_LINES).join("\n")
      : displayContent;

  let diffPatch: string | null = null;
  if (!isAddition && oldStr && newStr && !skipDiff) {
    try {
      const hunks = computeDiff(oldStr, newStr);
      if (hunks.length > 0) {
        const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
        diffPatch = header + hunks.flatMap(h => h.lines).join("\n") + "\n";
      }
    } catch {
      /* ignore */
    }
  }

  const showFile = !diffPatch && !!displayContent;

  return (
    <div className="border border-accent-border rounded-lg overflow-hidden bg-gh-bg-secondary/30 mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 text-accent shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
        </svg>
        <span className="font-medium text-gh-text truncate">{filePath}</span>
        {viewRange && (
          <span className="shrink-0 text-gh-text-secondary/70">
            :{viewRange[0]}-{viewRange[1]}
          </span>
        )}
      </div>
      {diffPatch ? (
        <div className={!expanded && isOverLimit ? "max-h-[440px] overflow-hidden" : ""}>
          <PatchRenderer patch={diffPatch} lang={lang} />
        </div>
      ) : showFile ? (
        <FileRenderer content={truncatedContent} lang={lang} />
      ) : null}
      {isOverLimit && (
        <div className="text-center border-t border-accent-border">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-medium text-accent hover:underline py-2"
          >
            {expanded ? "Show less" : `Show more (${totalLines} lines)`}
          </button>
        </div>
      )}
    </div>
  );
}
