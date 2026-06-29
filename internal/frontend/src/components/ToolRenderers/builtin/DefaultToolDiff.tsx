import type { ToolRendererProps } from "../types";
import { effectiveToolKind, getToolSummary } from "../../../utils/toolDisplay";
import { CopyButton } from "../../CopyButton";

function ToolDataBlock({ label, content }: { label: string; content: string }) {
  let formatted = content;
  if (content.startsWith("{") || content.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted = JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        <span className="text-[10px] text-gh-text-secondary/60">
          (
          {content.length > 1024 ? `${(content.length / 1024).toFixed(1)}kb` : `${content.length}b`}
          )
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <CopyButton text={content} />
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}

export function DefaultToolDiff({ tool, compact }: ToolRendererProps) {
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="text-gh-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="text-gh-text truncate min-w-0">{summary}</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
      {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
    </div>
  );
}
