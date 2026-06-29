import { Files } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { CopyButton } from "../../CopyButton";

interface GlobInput {
  pattern?: string;
}

export function GlobToolDiff({ tool, compact, onCopy }: ToolRendererProps) {
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
  if (!count && output) {
    count = output.split("\n").filter(Boolean).length;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Files size={12} className="text-violet-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">glob:</span>
        <span className="text-gh-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0 text-gh-text-secondary ml-auto">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <Files size={12} className="text-violet-400 shrink-0" />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">glob:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0 text-gh-text-secondary">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
        {onCopy && (
          <button
            type="button"
            onClick={() => onCopy(output)}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer ml-auto shrink-0"
            title="Copy results"
          >
            <CopyButton text={output} />
          </button>
        )}
      </div>
      {output && (
        <div className="relative group">
          <CopyButton text={output} className="absolute top-1 right-1 z-10" />
          <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
