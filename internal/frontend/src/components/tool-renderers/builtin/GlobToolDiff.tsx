import { Files } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface GlobInput {
  pattern?: string;
}

export function GlobToolDiff({ tool, variant, onCopy: _onCopy }: ToolRendererProps) {
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

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Files size={12} className="text-violet-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">glob:</span>
        <span className="text-ov-text truncate min-w-0" title={pattern}>
          {pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}
        </span>
        {count > 0 && (
          <span className="shrink-0 text-ov-text-secondary ml-auto">
            {count} file{count === 1 ? "" : "s"}
          </span>
        )}
      </div>
    );
  }

  return output ? (
    <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-ov-text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
      {output}
    </pre>
  ) : null;
}
