import { File, BookOpen, Copy, Check, ArrowRight, MessageSquareText } from "lucide-react";
import type { FileAccess } from "../../utils/fileAccess";
import { readPreviewContent } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";
import { FileRenderer, HunkRenderer } from "../DiffRenderer";
import { CopyButton } from "../ui/CopyButton";
import type { MergedFileDiff } from "../../utils/diffTree";
import { useCopy } from "../../hooks/useCopy";

interface FileDetailProps {
  access: FileAccess | null;
  fileName: string;
  mergedDiff?: MergedFileDiff | null;
  sessionDirectory?: string;
  onJump?: (messageIndex: number, messageId?: string) => void;
}

export function FileDetail({
  access,
  fileName,
  mergedDiff,
  sessionDirectory,
  onJump,
}: FileDetailProps) {
  const { copied, copy } = useCopy(2000);

  // Show placeholder when neither a read access nor a merged diff is available
  if (!access && !mergedDiff) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-ov-text-secondary">
        <div className="text-center">
          <File size={28} className="mx-auto mb-2 opacity-40" />
          Select a file to view its content
        </div>
      </div>
    );
  }

  // Edit/write takes priority over read when a file was both read and edited.
  // Render the merged diff exactly like DiffView does when it exists.
  if (mergedDiff) {
    const fullPath = sessionDirectory ? `${sessionDirectory}/${mergedDiff.path}` : mergedDiff.path;
    const lang = detectLanguage(mergedDiff.path);
    if (mergedDiff.hunks.length > 0) {
      return (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="group flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
            <File size={14} className="shrink-0 text-ov-text-secondary" />
            <span
              className="font-mono text-xs text-ov-text-secondary truncate min-w-0"
              title={fullPath}
            >
              {fullPath}
            </span>
            <CopyButton text={fullPath} iconSize={12} />
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
            {mergedDiff.hunks.map((hunk, i) => {
              const msgIdx = hunk.messageIndex;
              const msgId = hunk.messageId;
              const prev = i > 0 ? mergedDiff.hunks[i - 1] : undefined;
              const anchorKey = msgId ?? `idx:${msgIdx}`;
              const prevAnchorKey = prev ? (prev.messageId ?? `idx:${prev.messageIndex}`) : "";
              const showIndicator =
                !!onJump && (msgId !== undefined || msgIdx >= 0) && anchorKey !== prevAnchorKey;
              return (
                <div key={i}>
                  {showIndicator && (
                    <button
                      type="button"
                      onClick={() => onJump(msgIdx, msgId)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-ov-text-secondary/60 hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors w-full"
                      title={msgIdx >= 0 ? `Jump to message #${msgIdx + 1}` : "Jump to message"}
                    >
                      <MessageSquareText size={10} />
                      <span>{msgIdx >= 0 ? `Message #${msgIdx + 1}` : "Message"}</span>
                      <ArrowRight size={10} />
                    </button>
                  )}
                  <HunkRenderer hunk={hunk} lang={lang} />
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="group flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
          <File size={14} className="shrink-0 text-ov-text-secondary" />
          <span
            className="font-mono text-xs text-ov-text-secondary truncate min-w-0"
            title={fullPath}
          >
            {fullPath}
          </span>
          <CopyButton text={fullPath} iconSize={12} />
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-sm text-ov-text-secondary">
          Patch content not available for this file
        </div>
      </div>
    );
  }

  const isRead = access?.kind === "read";
  if (isRead && access) {
    const content = readPreviewContent(access.tool);
    const lang = detectLanguage(access.filePath);
    const fullPath = sessionDirectory ? `${sessionDirectory}/${access.filePath}` : access.filePath;
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
          <BookOpen size={14} className="text-cyan-400 shrink-0" />
          <span className="text-xs font-mono text-ov-text truncate" title={fullPath}>
            {fileName}
          </span>
          <span
            className="text-[11px] text-ov-text-secondary truncate hidden sm:inline"
            title={fullPath}
          >
            {fullPath}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {onJump && (
              <button
                type="button"
                onClick={() => onJump(access.messageIndex, access.messageId)}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-ov-text-secondary hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors"
                title="Jump timeline to this read"
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
          {content ? (
            <FileRenderer content={content} lang={lang} />
          ) : (
            <div className="text-xs text-ov-text-secondary">No preview available for this read</div>
          )}
        </div>
      </div>
    );
  }

  // Fallback for edit/write without a merged diff (e.g. edits not yet loaded)
  const fallbackRel = access?.filePath ?? fileName;
  const fallbackPath = sessionDirectory ? `${sessionDirectory}/${fallbackRel}` : fallbackRel;
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
        <File size={14} className="text-ov-text-secondary shrink-0" />
        <span className="text-xs font-mono text-ov-text truncate" title={fallbackPath}>
          {fileName}
        </span>
        <span
          className="text-[11px] text-ov-text-secondary truncate hidden sm:inline"
          title={fallbackPath}
        >
          {fallbackPath}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {access && onJump && (
            <button
              type="button"
              onClick={() => onJump(access.messageIndex, access.messageId)}
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
            onClick={() => copy(fallbackPath)}
            className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-ov-text-secondary">
        No diff content
      </div>
    </div>
  );
}
