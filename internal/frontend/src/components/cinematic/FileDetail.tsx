import { File, BookOpen, Copy, Check, ArrowRight, MessageSquareText } from "lucide-react";
import type { FileAccess } from "../../utils/fileAccess";
import { readPreviewContent } from "../../utils/fileAccess";
import { detectLanguage } from "../../utils/detectLanguage";
import { FileRenderer, HunkRenderer } from "../DiffRenderer";
import { mergeFileEdits } from "../../utils/diffTree";
import { useCopy } from "../../hooks/useCopy";

interface FileDetailProps {
  access: FileAccess | null;
  fileName: string;
  allAccessForFile: FileAccess[];
  onJump?: (messageIndex: number, messageId?: string) => void;
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

  // For reads, show preview content directly
  if (isRead) {
    const content = readPreviewContent(access.tool);
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
          <BookOpen size={14} className="text-cyan-400 shrink-0" />
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

  // For edits/writes, merge all edits for this file like DiffView does
  const fileEdits = allAccessForFile.map((fa) => ({
    filePath: fa.filePath,
    toolName: fa.tool.name,
    oldStr: (() => {
      try {
        const input = JSON.parse(fa.tool.input);
        return input.old_str || input.old_string || input.oldString || "";
      } catch {
        return "";
      }
    })(),
    newStr: (() => {
      try {
        const input = JSON.parse(fa.tool.input);
        return input.new_str || input.new_string || input.newString || "";
      } catch {
        return "";
      }
    })(),
    content: (() => {
      try {
        const input = JSON.parse(fa.tool.input);
        return input.content || input.file_text || "";
      } catch {
        return "";
      }
    })(),
    timestamp: fa.timestamp as unknown as string,
    messageIndex: fa.messageIndex,
    messageId: fa.messageId,
  }));

  // Use mergeFileEdits to get proper hunks with messageIndex/messageId and green/red diff
  const merged = mergeFileEdits(access.filePath, fileEdits as any);
  const hunks = merged.hunks;

  // For copy, use the latest new content
  const latestContent = (() => {
    const last = allAccessForFile[allAccessForFile.length - 1];
    try {
      const input = JSON.parse(last.tool.input);
      return (
        input.new_str ||
        input.new_string ||
        input.newString ||
        input.content ||
        input.file_text ||
        ""
      );
    } catch {
      return "";
    }
  })();

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
        <File size={14} className="text-ov-text-secondary shrink-0" />
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
            onClick={() => copy(latestContent || access.filePath)}
            className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {hunks.length > 0 ? (
          <div className="space-y-3">
            {hunks.map((hunk, i) => {
              const prev = i > 0 ? hunks[i - 1] : undefined;
              const anchorKey = (hunk as any).messageId ?? `idx:${hunk.messageIndex}`;
              const prevAnchorKey = prev
                ? ((prev as any).messageId ?? `idx:${prev.messageIndex}`)
                : "";
              const showJump = !!onJump && anchorKey !== prevAnchorKey;
              return (
                <div key={i}>
                  {showJump && (
                    <button
                      type="button"
                      onClick={() => onJump(hunk.messageIndex, (hunk as any).messageId)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-ov-text-secondary/60 hover:text-accent hover:bg-accent/5 rounded cursor-pointer transition-colors w-full"
                      title={
                        hunk.messageIndex >= 0
                          ? `Jump to message #${hunk.messageIndex + 1}`
                          : "Jump to message"
                      }
                    >
                      <MessageSquareText size={10} />
                      <span>
                        {hunk.messageIndex >= 0 ? `Message #${hunk.messageIndex + 1}` : "Message"}
                      </span>
                      <ArrowRight size={10} />
                    </button>
                  )}
                  <HunkRenderer hunk={hunk} lang={lang} />
                </div>
              );
            })}
          </div>
        ) : latestContent ? (
          <FileRenderer content={latestContent} lang={lang} />
        ) : (
          <div className="text-xs text-ov-text-secondary">No diff content</div>
        )}
      </div>
    </div>
  );
}
