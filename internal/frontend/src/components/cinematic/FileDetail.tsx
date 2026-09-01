import { File, BookOpen, Copy, Check, ArrowRight, MessageSquareText } from "lucide-react";
import type { FileAccess } from "../../utils/fileAccess";
import { readPreviewContent } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";
import { FileRenderer, HunkRenderer } from "../DiffRenderer";
import { computeDiff } from "../../utils/diff";
import { useCopy } from "../../hooks/useCopy";

interface FileDetailProps {
  access: FileAccess | null;
  fileName: string;
  allAccessForFile: FileAccess[];
  onJump?: (access: FileAccess) => void;
}

export function FileDetail({ access, fileName, allAccessForFile, onJump }: FileDetailProps) {
  const { copied, copy } = useCopy(2000);

  if (!access) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-ov-text-secondary">
        <div className="text-center">
          <File size={28} className="mx-auto mb-2 opacity-40" />
          Select a file to view its content
        </div>
      </div>
    );
  }

  const lang = detectLanguage(access.filePath);
  const isRead = access.kind === "read";

  let content: string = "";
  let hunks: ReturnType<typeof computeDiff> | null = null;
  if (isRead) {
    content = readPreviewContent(access.tool);
  } else {
    const latest = allAccessForFile[allAccessForFile.length - 1];
    const input = (() => {
      try {
        return JSON.parse(latest.tool.input);
      } catch {
        return {};
      }
    })();
    const oldStr: string = input.old_str || input.old_string || input.oldString || "";
    const newStr: string = input.new_str || input.new_string || input.newString || "";
    const fileContent: string = input.content || input.file_text || "";
    if (oldStr && newStr) {
      try {
        hunks = computeDiff(oldStr, newStr);
      } catch {
        hunks = null;
      }
      content = newStr;
    } else if (fileContent) {
      content = fileContent;
    } else if (newStr) {
      content = newStr;
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
        {isRead ? (
          <BookOpen size={14} className="text-cyan-400 shrink-0" />
        ) : (
          <File size={14} className="text-ov-text-secondary shrink-0" />
        )}
        <span className="text-xs font-mono text-ov-text truncate" title={access.filePath}>
          {fileName}
        </span>
        <span
          className="text-[11px] text-ov-text-secondary truncate hidden sm:inline"
          title={access.filePath}
        >
          {access.filePath}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onJump && (
            <button
              type="button"
              onClick={() => onJump(access)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-ov-text-secondary hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors"
              title="Jump timeline to this change"
            >
              <MessageSquareText size={11} />
              <span>Jump to</span>
              <ArrowRight size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={() => copy(content || access.filePath)}
            className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {isRead ? (
          content ? (
            <FileRenderer content={content} lang={lang} />
          ) : (
            <div className="text-xs text-ov-text-secondary">No preview available for this read</div>
          )
        ) : hunks && hunks.length > 0 ? (
          <div className="space-y-2">
            {hunks.map((h, i) => (
              <HunkRenderer key={i} hunk={h} lang={lang} />
            ))}
          </div>
        ) : content ? (
          <FileRenderer content={content} lang={lang} />
        ) : (
          <div className="text-xs text-ov-text-secondary">No diff content</div>
        )}
      </div>
    </div>
  );
}
