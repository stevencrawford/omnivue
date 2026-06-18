import { useEffect, useRef, useState } from "react";
import type { ToolCall } from "../../hooks/useApi";

interface BashMetadata {
  output?: string;
  exit?: number;
  description?: string;
  truncated?: boolean;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-gh-bg-secondary border border-accent-border text-gh-text-secondary hover:text-gh-text"
    >
      {copied ? "Copied" : "Copy"}
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
