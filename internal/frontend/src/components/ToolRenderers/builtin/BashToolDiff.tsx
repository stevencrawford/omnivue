import { Check, X, Terminal } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { CopyButton } from "../../CopyButton";

interface BashMetadata {
  output?: string;
  exit?: number;
  description?: string;
  truncated?: boolean;
}

export function BashToolDiff({ tool, compact, onCopy }: ToolRendererProps) {
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

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Terminal size={12} className={success ? "text-emerald-400 shrink-0" : "text-red-400 shrink-0"} />
        <span className="text-gh-text-secondary/70 shrink-0">$</span>
        <span className="text-gh-text truncate min-w-0">{command}</span>
        {success ? (
          <Check size={11} className="text-emerald-400 shrink-0 ml-auto" />
        ) : (
          <X size={11} className="text-red-400 shrink-0 ml-auto" />
        )}
      </div>
    );
  }

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <span className={success ? "text-emerald-400 shrink-0" : "text-red-400 shrink-0"}>
          {success ? <Check size={12} /> : <X size={12} />}
        </span>
        {description && <span className="text-gh-text/70 truncate">{description}</span>}
        <span className="text-gh-text shrink-0 font-mono">$ {command}</span>
        {truncated && <span className="shrink-0 ml-auto text-gh-text-secondary/60">truncated</span>}
        {onCopy && (
          <button
            type="button"
            onClick={() => onCopy(command)}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer ml-auto"
            title="Copy command"
          >
            <CopyButton text={command} />
          </button>
        )}
      </div>
      <div className="relative group px-3 py-2 bg-gh-bg-secondary/30">
        <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all">
          <span className="text-accent-secondary">$ </span>
          {command}
        </pre>
      </div>
      {stdout && (
        <div className="relative group border-t border-accent-border">
          <CopyButton text={stdout} className="absolute top-1 right-1 z-10" />
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {stdout}
          </pre>
        </div>
      )}
    </div>
  );
}
