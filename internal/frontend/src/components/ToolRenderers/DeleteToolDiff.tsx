import { Trash2 } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { CopyButton } from "../CopyButton";

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
    <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03] group">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
        <Trash2 size={14} className="text-red-400 shrink-0" />
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-gh-text truncate">{baseName}</span>
        <span className="text-gh-text-secondary/60 truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
        <CopyButton text={filePath} />
      </div>
    </div>
  );
}
