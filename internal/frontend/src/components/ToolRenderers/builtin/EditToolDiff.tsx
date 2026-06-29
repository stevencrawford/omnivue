import { useState } from "react";
import { File, FilePen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { computeDiff } from "../../../utils/diff";
import { PatchRenderer, FileRenderer } from "../../DiffRenderer";

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
  const totalLines = displayContent ? displayContent.split("\n").length : 0;

  let diffPatch: string | null = null;
  if (!isAddition && oldStr && newStr && !skipDiff) {
    try {
      const hunks = computeDiff(oldStr, newStr);
      if (hunks.length > 0) {
        const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
        diffPatch = header + hunks.flatMap((h) => h.lines).join("\n") + "\n";
      }
    } catch {
      /* ignore */
    }
  }

  const showFile = !diffPatch && !!displayContent;

  return (
    <>
      {diffPatch ? (
        <div
          className={
            "relative group " + (!showAll && totalLines > 20 ? "max-h-[440px] overflow-hidden" : "")
          }
        >
          <PatchRenderer patch={diffPatch} lang={lang} />
        </div>
      ) : showFile ? (
        <div className="relative group">
          <FileRenderer content={displayContent} lang={lang} />
        </div>
      ) : null}
      {totalLines > 20 && (
        <div className="text-center border-t border-accent-border">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
          >
            {showAll ? "Show less" : "Show all"}
          </button>
        </div>
      )}
    </>
  );
}
