import type { ToolRendererProps } from "../../types";

export function ExampleToolDiff({ tool, variant, onCopy }: ToolRendererProps) {
  const kind = "example";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="font-semibold text-violet-400 shrink-0">{kind}:</span>
        <span className="text-ov-text truncate min-w-0">{tool.name}</span>
      </div>
    );
  }

  return (
    <div className="border border-ov-border rounded-lg overflow-hidden mb-3 bg-ov-bg-secondary/50">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-ov-bg-secondary/50 text-[11px] font-mono text-ov-text-secondary">
        <span className="font-medium text-ov-text">{kind}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {tool.input && (
          <div>
            <span className="text-[11px] font-semibold text-ov-text-secondary uppercase">
              Input
            </span>
            <pre className="mt-0.5 p-2 bg-ov-bg rounded text-[11px] font-mono overflow-x-auto text-ov-text">
              {tool.input}
            </pre>
          </div>
        )}
        {tool.output && (
          <div>
            <span className="text-[11px] font-semibold text-ov-text-secondary uppercase">
              Output
            </span>
            {onCopy && (
              <button
                type="button"
                onClick={() => onCopy(tool.output || "")}
                className="text-[11px] text-accent hover:underline ml-2 cursor-pointer"
              >
                Copy
              </button>
            )}
            <pre className="mt-0.5 p-2 bg-ov-bg rounded text-[11px] font-mono overflow-x-auto text-ov-text whitespace-pre-wrap">
              {tool.output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
