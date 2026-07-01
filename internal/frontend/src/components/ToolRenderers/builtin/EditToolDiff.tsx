import { useMemo } from "react";
import { File, FilePen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { computeDiff } from "../../../utils/diff";
import { PatchRenderer, FileRenderer } from "../../DiffRenderer";

const UNIFIED_DIFF_RE = /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m;

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
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
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

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        {isWrite ? (
          <FilePen size={12} className="text-accent shrink-0" />
        ) : (
          <File size={12} className="text-accent shrink-0" />
        )}
        <span className="text-ov-text-secondary/70 shrink-0">
          {tool.name === "write" ? "write:" : "edit:"}
        </span>
        <span className="text-ov-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {viewRange && (
          <span className="text-ov-text-secondary/70 shrink-0">
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
  } else if (isUnifiedDiff) {
    diffPatch = displayContent.startsWith("---")
      ? displayContent
      : `--- a/${filePath}\n+++ b/${filePath}\n${displayContent}`;
  }

  if (diffPatch) {
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto">
        <PatchRenderer patch={diffPatch} lang={lang} />
      </div>
    );
  }

  if (displayContent) {
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto">
        <FileRenderer content={displayContent} lang={lang} />
      </div>
    );
  }

  return null;
}
