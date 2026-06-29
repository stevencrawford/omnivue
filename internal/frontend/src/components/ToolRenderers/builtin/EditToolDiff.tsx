import { useState, useMemo, type ReactNode } from "react";
import { File, FilePen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { computeDiff } from "../../../utils/diff";
import { PatchRenderer, FileRenderer } from "../../DiffRenderer";

const UNIFIED_DIFF_RE = /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m;

const MAX_VISIBLE_LINES = 35;

interface EditInput {
  path?: string;
  filePath?: string;
  file_path?: string;
  old_str?: string;
  new_str?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  view_range?: [number, number];
}

export function EditToolDiff({
  tool,
  compact,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  const [showAll, setShowAll] = useState(false);

  let input: EditInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const oldStr = input.old_str || input.oldString || "";
  const newStr = input.new_str || input.newString || "";
  const content = input.content || "";
  const viewRange = input.view_range;
  const lang = detectLanguage(filePath);

  const isWrite = tool.name === "write" && !!content;
  const isAddition = (viewRange != null && !oldStr) || isWrite;

  const skipDiff = (oldStr && oldStr.length > 20000) || (newStr && newStr.length > 20000);

  const baseName = filePath.split("/").pop() || filePath;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        {isWrite ? (
          <FilePen size={12} className="text-accent shrink-0" />
        ) : (
          <File size={12} className="text-accent shrink-0" />
        )}
        <span className="text-gh-text-secondary/70 shrink-0">
          {tool.name === "write" ? "write:" : "edit:"}
        </span>
        <span className="text-gh-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {viewRange && (
          <span className="text-gh-text-secondary/70 shrink-0">
            :{viewRange[0]}-{viewRange[1]}
          </span>
        )}
      </div>
    );
  }

  const displayContent = newStr || content;

  const isUnifiedDiff = useMemo(() => {
    const c = displayContent;
    return c.length > 10 && UNIFIED_DIFF_RE.test(c);
  }, [displayContent]);

  let diffPatch: string | null = null;
  let diffLines: string[] | null = null;
  if (!isAddition && oldStr && newStr && !skipDiff) {
    try {
      const hunks = computeDiff(oldStr, newStr);
      if (hunks.length > 0) {
        const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
        diffPatch = header + hunks.flatMap((h) => h.lines).join("\n") + "\n";
        diffLines = diffPatch.split("\n");
      }
    } catch {
      /* ignore */
    }
  } else if (isUnifiedDiff) {
    const patch = displayContent.startsWith("---")
      ? displayContent
      : `--- a/${filePath}\n+++ b/${filePath}\n${displayContent}`;
    diffPatch = patch;
    diffLines = patch.split("\n");
  }

  const showFile = !diffPatch && !!displayContent;
  const fileLines = displayContent ? displayContent.split("\n") : null;
  const contentLines = diffLines || fileLines || [];
  const totalLines = contentLines.length;
  const isLong = totalLines > MAX_VISIBLE_LINES;

  let renderedContent: ReactNode = null;
  if (diffPatch) {
    const displayPatch =
      !showAll && isLong
        ? contentLines.slice(0, MAX_VISIBLE_LINES).join("\n") +
          `\n\n... (${totalLines - MAX_VISIBLE_LINES} more lines)`
        : diffPatch;
    renderedContent = (
      <div className="relative group">
        <PatchRenderer patch={displayPatch} lang={lang} />
      </div>
    );
  } else if (showFile) {
    const displayFile =
      !showAll && isLong && fileLines
        ? fileLines.slice(0, MAX_VISIBLE_LINES).join("\n") +
          `\n\n... (${totalLines - MAX_VISIBLE_LINES} more lines)`
        : displayContent;
    renderedContent = (
      <div className="relative group">
        <FileRenderer content={displayFile} lang={lang} />
      </div>
    );
  }

  return (
    <>
      {renderedContent}
      {renderedContent && isLong && (
        <div className="text-center border-t border-gh-border">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
          >
            {showAll ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </>
  );
}
