import type { ToolCall } from "../../hooks/useApi";

interface GrepInput {
  pattern?: string;
  query?: string;
  path?: string;
  include?: string;
}

export function GrepToolDiff({ tool }: { tool: ToolCall }) {
  let input: GrepInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  let matchCount = 0;
  let truncated = false;
  try {
    const meta = JSON.parse(tool.metadata || "{}");
    matchCount = meta.matches ?? 0;
    truncated = !!meta.truncated;
  } catch {
    /* ignore */
  }

  const pattern = input.pattern || input.query || "";
  const results = tool.output || "";
  const maxLines = 200;
  const lines = results.split("\n");
  const displayLines = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const overLimit = lines.length > maxLines;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.75 1.5a.75.75 0 0 0-1.5 0v5.25H2a.75.75 0 0 0 0 1.5h5.25v5.25a.75.75 0 0 0 1.5 0V8.25H14a.75.75 0 0 0 0-1.5H8.75V1.5Z" />
        </svg>
        <span className="font-medium text-gh-text truncate" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {matchCount > 0 && (
          <span className="shrink-0">
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">truncated</span>}
      </div>
      {displayLines.length > 0 && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
          {displayLines.join("\n")}
          {overLimit && `\n\n... (${lines.length - maxLines} more lines)`}
        </pre>
      )}
    </div>
  );
}
