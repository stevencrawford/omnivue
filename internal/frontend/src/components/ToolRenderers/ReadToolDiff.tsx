import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";
import { detectLanguage } from "../../utils/detectLanguage";
import { FileRenderer } from "../DiffRenderer";
import { useCopy } from "../../hooks/useCopy";

interface ReadInput {
  filePath?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

export function ReadToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  function CopyBtn({ text }: { text: string }) {
    const { copied, copy } = useCopy(1500);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          copy(text);
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated z-10"
        title="Copy"
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
    );
  }

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
  const lang = detectLanguage(filePath);

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^<path>.*<\/path>\n?/gm, "")
    .replace(/^<type>.*<\/type>\n?/gm, "")
    .replace(/^<content>\n?/gm, "")
    .replace(/\n<\/content>\s*$/gm, "")
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
        <div className="relative group">
          <CopyBtn text={cleanContent} />
          <FileRenderer content={cleanContent} lang={lang} />
        </div>
      )}
    </div>
  );
}
