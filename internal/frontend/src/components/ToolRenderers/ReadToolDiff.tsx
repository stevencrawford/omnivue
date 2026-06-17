import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";
import { File } from "@pierre/diffs/react";

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    go: "go",
    py: "python",
    rs: "rust",
    rb: "ruby",
    java: "java",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sh: "shellscript",
    bash: "shellscript",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
    c: "c",
    cpp: "cpp",
    h: "c",
  };
  return langMap[ext] || "";
}

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

  const baseOptions = {
    disableLineNumbers: false,
    disableFileHeader: true,
    theme: { light: "github-light" as const, dark: "github-dark" as const },
  };

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
        <File file={{ name: filePath, contents: cleanContent, lang }} options={baseOptions} />
      )}
    </div>
  );
}
