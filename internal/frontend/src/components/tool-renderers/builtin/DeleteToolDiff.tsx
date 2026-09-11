import { Trash2 } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface DeleteInput {
  filePath?: string;
  relativeWorkspacePath?: string;
  path?: string;
}

export function DeleteToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let input: DeleteInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.relativeWorkspacePath || input.path || "";
  const baseName = filePath.split("/").pop() || filePath;

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Trash2 size={12} className="text-red-400 shrink-0" />
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-ov-text truncate min-w-0">{baseName}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
      <Trash2 size={14} className="text-red-400 shrink-0" />
      <span className="text-red-400 font-semibold shrink-0">delete:</span>
      <span className="text-ov-text truncate">{baseName}</span>
      <span className="text-ov-text-secondary/60 truncate flex-1 min-w-0" title={filePath}>
        {filePath}
      </span>
    </div>
  );
}
