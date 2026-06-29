import { Trash2 } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { CopyButton } from "../../CopyButton";
import { BookmarkButton } from "../BookmarkButton";

interface DeleteInput {
  filePath?: string;
  relativeWorkspacePath?: string;
  path?: string;
}

export function DeleteToolDiff({ tool, compact, onCopy, onBookmark, isBookmarked }: ToolRendererProps) {
  let input: DeleteInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.relativeWorkspacePath || input.path || "";
  const baseName = filePath.split("/").pop() || filePath;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Trash2 size={12} className="text-red-400 shrink-0" />
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-gh-text truncate min-w-0">{baseName}</span>
      </div>
    );
  }

  return (
    <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03] group">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
        <Trash2 size={14} className="text-red-400 shrink-0" />
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-gh-text truncate">{baseName}</span>
        <span className="text-gh-text-secondary/60 truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />}
          {onCopy ? (
            <button
              type="button"
              onClick={() => onCopy(filePath)}
              className="text-gh-text-secondary hover:text-gh-text cursor-pointer"
              title="Copy path"
            >
              <CopyButton text={filePath} />
            </button>
          ) : (
            <CopyButton text={filePath} />
          )}
        </div>
      </div>
    </div>
  );
}
