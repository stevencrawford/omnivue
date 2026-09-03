import { useMemo } from "react";
import { File, FilePen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import type { ToolCall } from "../../../hooks/types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { computeDiff, parseUnifiedDiff, type DiffHunk } from "../../../utils/diff";
import { extractPatchBodies, isPatchLike } from "../../../utils/patchBody";
import { HunkRenderer, FileRenderer } from "../../DiffRenderer";

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

  const patchInfo = useMemo(() => {
    const c = displayContent;
    if (!c || c.length <= 10) return null;
    if (!isPatchLike(c)) return null;
    const bodies = extractPatchBodies(c);
    const entries: Array<{ path: string; body: string }> = Object.entries(bodies).map(([p, b]) => ({
      path: p || filePath,
      body: b,
    }));
    const valid = entries.filter((e) => e.body && isPatchLike(e.body));
    if (valid.length === 0) return null;
    return valid;
  }, [displayContent, filePath]);

  const hunksByFile = useMemo(() => {
    if (!patchInfo) return null;
    const out: Array<{ path: string; hunks: DiffHunk[] }> = [];
    for (const { path, body } of patchInfo) {
      try {
        const h = parseUnifiedDiff(body);
        if (h.length > 0) out.push({ path, hunks: h });
      } catch {
        /* ignore */
      }
    }
    return out.length ? out : null;
  }, [patchInfo]);

  // Multi-file or single-file patch diff (swallow markers, bare @@ supported)
  if (hunksByFile && hunksByFile.length > 0) {
    if (hunksByFile.length === 1 && hunksByFile[0].path === filePath) {
      const hunks = hunksByFile[0].hunks;
      return (
        <div className="relative group max-h-[80vh] overflow-y-auto overflow-x-hidden max-w-full min-w-0">
          {hunks.map((hunk, i) => (
            <HunkRenderer key={i} hunk={hunk} lang={lang} />
          ))}
        </div>
      );
    }
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto overflow-x-hidden max-w-full min-w-0 space-y-3">
        {hunksByFile.map(({ path, hunks }) => {
          const fileLang = detectLanguage(path);
          const name = path.split("/").pop() || path;
          return (
            <div key={path} className="min-w-0 overflow-hidden">
              <div className="px-2 py-1 text-[11px] font-mono text-ov-text-secondary bg-ov-bg-secondary border border-ov-border rounded-t truncate">
                {name}
              </div>
              <div className="border border-t-0 border-ov-border rounded-b overflow-hidden min-w-0">
                {hunks.map((hunk, i) => (
                  <HunkRenderer key={i} hunk={hunk} lang={fileLang} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  let hunks: DiffHunk[] | null = null;
  if (!isAddition && oldStr && newStr && !skipDiff && !patchInfo) {
    try {
      hunks = computeDiff(oldStr, newStr);
    } catch {
      /* ignore */
    }
  }

  if (hunks && hunks.length > 0) {
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto overflow-x-hidden max-w-full min-w-0">
        {hunks.map((hunk, i) => (
          <HunkRenderer key={i} hunk={hunk} lang={lang} />
        ))}
      </div>
    );
  }

  if (displayContent) {
    return (
      <div className="relative group max-h-[80vh] overflow-y-auto overflow-x-hidden max-w-full min-w-0">
        <FileRenderer content={displayContent} lang={lang} />
      </div>
    );
  }

  return null;
}
