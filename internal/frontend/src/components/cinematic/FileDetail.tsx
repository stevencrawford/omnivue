import { BookOpen, File, ArrowRight, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import type { FileAccess } from "../../utils/fileAccess";
import { readPreviewContent } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";
import { FileRenderer, HunkRenderer } from "../DiffRenderer";
import { CopyButton } from "../ui/CopyButton";
import { EmptyPanel } from "../ui/EmptyPanel";
import type { MergedFileDiff } from "../../utils/diffTree";

interface FileDetailProps {
  access: FileAccess | null;
  fileName: string;
  mergedDiff?: MergedFileDiff | null;
  sessionDirectory?: string;
  onJump?: (messageIndex: number, messageId?: string) => void;
}

function FileDetailHeader({
  icon,
  fileName,
  fullPath,
  actions,
}: {
  icon: ReactNode;
  fileName: string;
  fullPath: string;
  actions?: ReactNode;
}) {
  return (
    <div className="group flex items-center gap-2 px-3 h-10 border-b border-ov-border bg-surface-elevated shrink-0">
      {icon}
      <span className="font-mono text-xs text-ov-text truncate min-w-0" title={fullPath}>
        {fileName}
      </span>
      <span
        className="text-[11px] text-ov-text-secondary truncate hidden sm:inline min-w-0"
        title={fullPath}
      >
        {fullPath}
      </span>
      <div className="ml-auto flex items-center gap-1 shrink-0">
        {actions}
        <CopyButton text={fullPath} iconSize={12} />
      </div>
    </div>
  );
}

function JumpButton({
  messageIndex,
  messageId,
  onJump,
  title,
}: {
  messageIndex: number;
  messageId?: string;
  onJump: (messageIndex: number, messageId?: string) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump(messageIndex, messageId)}
      className="flex items-center gap-1 px-2 py-1 text-[11px] text-ov-text-secondary hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors"
      title={title}
    >
      <MessageSquareText size={11} />
      <span>Jump to</span>
      <ArrowRight size={11} />
    </button>
  );
}

export function FileDetail({
  access,
  fileName,
  mergedDiff,
  sessionDirectory,
  onJump,
}: FileDetailProps) {
  if (!access && !mergedDiff) {
    return (
      <EmptyPanel
        icon={<File size={20} />}
        title="Select a file to view its content"
        hint="Reads and edits from the timeline appear in the file tree."
      />
    );
  }

  if (mergedDiff) {
    const fullPath = sessionDirectory ? `${sessionDirectory}/${mergedDiff.path}` : mergedDiff.path;
    const lang = detectLanguage(mergedDiff.path);
    if (mergedDiff.hunks.length > 0) {
      return (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <FileDetailHeader
            icon={<File size={14} className="shrink-0 text-ov-text-secondary" />}
            fileName={mergedDiff.path.split("/").pop() || mergedDiff.path}
            fullPath={fullPath}
          />
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
        <FileDetailHeader
          icon={<File size={14} className="shrink-0 text-ov-text-secondary" />}
          fileName={mergedDiff.path.split("/").pop() || mergedDiff.path}
          fullPath={fullPath}
        />
        <EmptyPanel icon={<File size={20} />} title="Patch content not available for this file" />
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
        <FileDetailHeader
          icon={<BookOpen size={14} className="text-cyan-400 shrink-0" />}
          fileName={fileName}
          fullPath={fullPath}
          actions={
            onJump ? (
              <JumpButton
                messageIndex={access.messageIndex}
                messageId={access.messageId}
                onJump={onJump}
                title="Jump timeline to this read"
              />
            ) : undefined
          }
        />
        <div className="flex-1 overflow-y-auto p-3">
          {content ? (
            <FileRenderer content={content} lang={lang} />
          ) : (
            <p className="text-xs text-ov-text-secondary">No preview available for this read</p>
          )}
        </div>
      </div>
    );
  }

  const fallbackRel = access?.filePath ?? fileName;
  const fallbackPath = sessionDirectory ? `${sessionDirectory}/${fallbackRel}` : fallbackRel;
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <FileDetailHeader
        icon={<File size={14} className="text-ov-text-secondary shrink-0" />}
        fileName={fileName}
        fullPath={fallbackPath}
        actions={
          access && onJump ? (
            <JumpButton
              messageIndex={access.messageIndex}
              messageId={access.messageId}
              onJump={onJump}
              title="Jump timeline to this change"
            />
          ) : undefined
        }
      />
      <EmptyPanel icon={<File size={20} />} title="No diff content available yet" />
    </div>
  );
}
