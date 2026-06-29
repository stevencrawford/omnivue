import { Check, Terminal, X } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface BashMetadata {
  output?: string;
  exit?: number;
  truncated?: boolean;
}

export function BashToolDiff({ tool, compact, onCopy: _onCopy }: ToolRendererProps) {
  let command = "";
  try {
    const input = JSON.parse(tool.input);
    command = input.command || "";
  } catch {
    /* ignore */
  }

  let stdout = tool.output || "";
  let exitCode: number | undefined;
  try {
    const meta: BashMetadata = JSON.parse(tool.metadata || "{}");
    if (meta.output && !stdout) stdout = meta.output;
    if (meta.exit != null) exitCode = meta.exit;
  } catch {
    /* ignore */
  }

  const success = exitCode == null || exitCode === 0;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Terminal
          size={12}
          className={success ? "text-emerald-400 shrink-0" : "text-red-400 shrink-0"}
        />
        <span className="text-gh-text-secondary/70 shrink-0">$</span>
        <span className="text-gh-text truncate min-w-0">{command}</span>
        {success ? (
          <Check size={11} className="text-emerald-400 shrink-0" />
        ) : (
          <X size={11} className="text-red-400 shrink-0" />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="relative group px-3 py-2 bg-gh-bg-secondary/30">
        <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all">
          <span className="text-accent-secondary">$ </span>
          {command}
        </pre>
      </div>
      {stdout && (
        <div className="relative group border-t border-accent-border">
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
            {stdout}
          </pre>
        </div>
      )}
    </>
  );
}
