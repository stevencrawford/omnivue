import { BookOpen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { FileRenderer } from "../../DiffRenderer";
import { CopyButton } from "../../CopyButton";
import { BookmarkButton } from "../BookmarkButton";

interface ReadInput {
  filePath?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

export function ReadToolDiff({ tool, compact, onCopy, onBookmark, isBookmarked }: ToolRendererProps) {
  let input: ReadInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const offset = input.offset ?? 1;
  const limit = input.limit ?? 0;
  const showLineRange = limit > 0;
  const lang = detectLanguage(filePath);

  const baseName = filePath.split("/").pop() || filePath;

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^<path>.*<\/path>\n?/gm, "")
    .replace(/^<type>.*<\/type>\n?/gm, "")
    .replace(/^<content>\n?/gm, "")
    .replace(/\n<\/content>\s*$/gm, "")
    .replace(/^[0-9]{5}\| ?/gm, "");

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <BookOpen size={12} className="text-cyan-400 shrink-0" />
        <span className="text-gh-text-secondary/70 shrink-0">read:</span>
        <span className="text-gh-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {showLineRange && (
          <span className="text-gh-text-secondary/70 shrink-0">
            :{offset}-{offset + limit}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <BookOpen size={12} className="text-cyan-400 shrink-0" />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">read:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {showLineRange && (
          <span className="text-gh-text-secondary/70 shrink-0">
            :{offset}-{offset + limit}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />}
          {onCopy ? (
            <button
              type="button"
              onClick={() => onCopy(cleanContent)}
              title="Copy content"
            >
              <CopyButton text={cleanContent} />
            </button>
          ) : (
            <CopyButton text={cleanContent} />
          )}
        </div>
      </div>
      {cleanContent && (
        <div className="relative group">
          <CopyButton text={cleanContent} className="absolute top-1 right-1 z-10" />
          <FileRenderer content={cleanContent} lang={lang} />
        </div>
      )}
    </div>
  );
}
