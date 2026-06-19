import { useState } from "react";
import type { ToolCall } from "../../hooks/useApi";
import { useCopy } from "../../hooks/useCopy";

interface BashMetadata {
  output?: string;
  exit?: number;
  description?: string;
  truncated?: boolean;
}

function CopyBtn({ text }: { text: string }) {
  const { copied, copy } = useCopy(1500);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        await copy(text);
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated"
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

function trimBashOutput(output: string): string {
  const lines = output.split("\n");
  const maxLines = 200;
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines)`;
  }
  return output;
}

export function BashToolDiff({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  let command = "";
  let description = "";
  try {
    const input = JSON.parse(tool.input);
    command = input.command || "";
    description = input.description || "";
  } catch {
    /* ignore */
  }

  let stdout = tool.output || "";
  let exitCode: number | undefined;
  let truncated = false;
  try {
    const meta: BashMetadata = JSON.parse(tool.metadata || "{}");
    if (meta.output && !stdout) stdout = meta.output;
    if (meta.exit != null) exitCode = meta.exit;
    if (meta.truncated) truncated = true;
  } catch {
    /* ignore */
  }

  const success = exitCode == null || exitCode === 0;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${expanded ? "border-b border-accent-border " : ""}bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`shrink-0 font-bold ${success ? "text-emerald-400" : "text-red-400"}`}>
          {success ? "\u2713" : "\u2717"}
        </span>
        {description && <span className="text-gh-text/70 truncate">{description}</span>}
        <span className="text-gh-text shrink-0 font-mono">$ {command}</span>
        {truncated && <span className="shrink-0 ml-auto text-gh-text-secondary/60">truncated</span>}
      </button>
      {expanded && (
        <>
          <div className="relative group px-3 py-2 bg-gh-bg-secondary/30">
            <CopyBtn text={command} />
            <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all">
              <span className="text-accent-secondary">$ </span>
              {command}
            </pre>
          </div>
          {stdout && (
            <div className="relative group border-t border-accent-border">
              <CopyBtn text={stdout} />
              <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {trimBashOutput(stdout)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
