import { useMemo } from "react";
import { File, FilePen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import type { ToolCall } from "../../../hooks/types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { computeDiff, parseUnifiedDiff, type DiffHunk } from "../../../utils/diff";
import { HunkRenderer, FileRenderer } from "../../DiffRenderer";

const UNIFIED_DIFF_RE = /^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/m;

interface EditInput {
  path?: string;
  filePath?: string;
  file_path?: string;
  old_str?: string;
  old_string?: string;
  new_str?: string;
  new_string?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  file_text?: string;
  view_range?: [number, number];
}

export interface EditInputValues {
  filePath: string;
  oldStr: string;
  newStr: string;
  content: string;
  viewRange?: [number, number];
  isWrite: boolean;
}

/** Parses a tool call's input JSON into its edit/write fields. */
export function editInputFromTool(tool: ToolCall): EditInputValues {
  let input: EditInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }
  return {
    filePath: input.filePath || input.file_path || input.path || "",
    oldStr: input.old_str || input.old_string || input.oldString || "",
    newStr: input.new_str || input.new_string || input.newString || "",
    content: input.content || input.file_text || "",
    viewRange: input.view_range,
    isWrite:
      (tool.name === "write" || tool.name === "create") && !!(input.content || input.file_text),
  };
}

export function EditToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  const { filePath, oldStr, newStr, content, viewRange } = editInputFromTool(tool);
  const lang = detectLanguage(filePath);

  const isWrite = (tool.name === "write" || tool.name === "create") && !!content;
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
          {tool.name === "write" || tool.name === "create" ? "write:" : "edit:"}
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

  let hunks: DiffHunk[] | null = null;
  if (!isAddition && oldStr && newStr && !skipDiff) {
    try {
      hunks = computeDiff(oldStr, newStr);
    } catch {
      /* ignore */
    }
  } else if (isUnifiedDiff) {
    hunks = parseUnifiedDiff(displayContent);
  }

  if (hunks && hunks.length > 0) {
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto">
        {hunks.map((hunk, i) => (
          <HunkRenderer key={i} hunk={hunk} lang={lang} />
        ))}
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
