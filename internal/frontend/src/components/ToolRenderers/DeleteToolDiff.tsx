import type { ToolCall } from "../../hooks/useApi";

interface DeleteInput {
  filePath?: string;
  relativeWorkspacePath?: string;
  path?: string;
}

export function DeleteToolDiff({ tool }: { tool: ToolCall }) {
  let input: DeleteInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.relativeWorkspacePath || input.path || "";
  const baseName = filePath.split("/").pop() || filePath;

  return (
    <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03]">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
        <svg className="size-3.5 text-red-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4h12M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M4 4v9.5A1.5 1.5 0 0 0 5.5 15h5A1.5 1.5 0 0 0 12 13.5V4" />
        </svg>
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-gh-text truncate">{baseName}</span>
        <span className="text-gh-text-secondary/60 truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
      </div>
    </div>
  );
}
