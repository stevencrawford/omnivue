import type { ToolCall } from "../../hooks/useApi";

interface GlobInput {
  pattern?: string;
}

export function GlobToolDiff({ tool }: { tool: ToolCall }) {
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

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5Z" />
        </svg>
        <span className="font-medium text-gh-text truncate" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {output && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  );
}
