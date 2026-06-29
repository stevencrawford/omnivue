import { useState, useMemo, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import type { ToolCall } from "../hooks/useApi";
import { effectiveToolKind } from "../utils/toolDisplay";
import { detectLanguage } from "../utils/detectLanguage";
import { MarkdownContent } from "./MarkdownContent";
import { ToolCallList } from "./ToolRenderers/ToolCallList";
import { FileRenderer } from "./DiffRenderer";
import { CopyButton } from "./CopyButton";

function extractInlineBlocks(content: string) {
  const blocks: Array<{
    type: "skill-context" | "file-context";
    content: string;
    fileName?: string;
  }> = [];

  let remaining = content;

  remaining = remaining.replace(
    /<skill-context(?:\s+(?:file|name)="([^"]*)")?\s*>([\s\S]*?)<\/skill-context>\n?/g,
    (_match, fileOrName, inner) => {
      blocks.push({
        type: "skill-context",
        content: inner.trim(),
        fileName: fileOrName || undefined,
      });
      return "";
    },
  );

  remaining = remaining.replace(
    /<file-context(?:\s+path="([^"]*)")?(?:\s+lang="([^"]*)")?\s*>([\s\S]*?)<\/file-context>\n?/g,
    (_match, filePath, _lang, inner) => {
      blocks.push({
        type: "file-context",
        content: inner.trim(),
        fileName: filePath || undefined,
      });
      return "";
    },
  );

  remaining = remaining.trim();
  return { blocks, remaining };
}

function CollapsibleBlock({
  content,
  label,
  icon,
  className,
  onOpenModal,
  defaultCollapsed = false,
}: {
  content: string;
  label: string;
  icon: ReactNode;
  className?: string;
  onOpenModal?: (content: string, title?: string) => void;
  defaultCollapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const lines = content.split("\n");
  const isLong = defaultCollapsed || lines.length > 20;
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n&#x2026;" : content;

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 ${className || ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        {icon}
        <span className="font-semibold text-[11px]">{label}</span>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          {!expanded && isLong && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg-secondary)] to-transparent z-10 pointer-events-none" />
          )}
          <MarkdownContent
            content={display}
            className="markdown-body--wide"
            onOpenModal={onOpenModal ? () => onOpenModal(content, label) : undefined}
            modalTitle={label}
          />
        </div>
      </div>
      {isLong && (
        <div className="flex justify-center border-t border-inherit">
          <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

function FileContextBlock({ block }: { block: { content: string; fileName?: string } }) {
  const [expanded, setExpanded] = useState(false);
  const fileName = block.fileName || "";
  const baseName = fileName.split("/").pop() || fileName;
  const lang = detectLanguage(fileName);
  const content = block.content;

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50">
      <button
        type="button"
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${
          expanded ? "border-b border-accent-border" : ""
        } bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          size={12}
          className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="text-gh-text-secondary/70 font-medium shrink-0">read:</span>
        <span className="font-medium text-gh-text truncate min-w-0" title={fileName}>
          {baseName}
        </span>
      </button>
      {expanded && content && (
        <div className="relative group">
          <CopyButton text={content} className="absolute top-1 right-1 z-10" />
          <FileRenderer content={content} lang={lang} />
        </div>
      )}
    </div>
  );
}

export function UserTurnView({
  content,
  toolCalls,
  sessionId,
  messageIndex,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
  bookmarkIdByRef,
}: {
  content: string;
  toolCalls?: ToolCall[];
  sessionId?: string;
  messageIndex?: number;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  isBookmarked?: boolean;
  bookmarkIdByRef?: Record<string, string>;
}) {
  const { blocks, remaining } = extractInlineBlocks(content);
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const [expanded, setExpanded] = useState(false);

  const readTools = useMemo(
    () =>
      (toolCalls ?? []).filter((t) => {
        const kind = effectiveToolKind(t);
        return kind === "read";
      }),
    [toolCalls],
  );

  const msgOnBookmark = useMemo(
    () =>
      onBookmark && sessionId && messageIndex !== undefined
        ? () => onBookmark(sessionId, messageIndex, undefined, content.slice(0, 80))
        : undefined,
    [onBookmark, sessionId, messageIndex, content],
  );

  const toolOnBookmark = useMemo(
    () =>
      onBookmark && sessionId && messageIndex !== undefined
        ? (toolCallId: string, label: string) =>
            onBookmark(sessionId, messageIndex, toolCallId, label)
        : undefined,
    [onBookmark, sessionId, messageIndex],
  );

  function renderReadTools() {
    if (readTools.length === 0) return null;
    return (
      <div className="mt-2 space-y-2">
        <ToolCallList
          toolCalls={readTools}
          agent={undefined}
          compact
          onOpenModal={onOpenModal}
          onPin={onPin}
          onBookmark={toolOnBookmark}
          bookmarkIdByRef={bookmarkIdByRef}
          sessionId={sessionId}
          messageIndex={messageIndex}
        />
      </div>
    );
  }

  if (blocks.length === 0) {
    const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n&#x2026;" : content;

    return (
      <div className="sess-user-turn">
        <div className="sess-user-turn-label">USER-REQUEST</div>
        <div className="relative">
          {!expanded && isLong && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg)] to-transparent z-10 pointer-events-none" />
          )}
          <MarkdownContent
            content={display}
            className="markdown-body--wide"
            onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
            modalTitle="USER-REQUEST"
            onBookmark={msgOnBookmark}
            isBookmarked={isBookmarked}
          />
        </div>
        {isLong && (
          <div className="flex justify-center mt-1">
            <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          </div>
        )}
        {renderReadTools()}
      </div>
    );
  }

  const isSkillOnly = blocks.length > 0 && !remaining;

  return (
    <div className="sess-user-turn">
      <div className="sess-user-turn-label">
        {isSkillOnly ? `SKILL: ${blocks[0].fileName || "Context"}` : "USER-REQUEST"}
      </div>
      {remaining && (
        <MarkdownContent
          content={remaining}
          className="markdown-body--wide"
          onOpenModal={() => onOpenModal?.(content, "USER-REQUEST")}
          modalTitle="USER-REQUEST"
          onBookmark={msgOnBookmark}
          isBookmarked={isBookmarked}
        />
      )}
      {blocks.map((block, i) =>
        block.type === "skill-context" ? (
          <CollapsibleBlock
            key={i}
            content={block.content}
            label={block.fileName || "Context"}
            icon={<Info size={16} className="text-sky-400 shrink-0" />}
            className="border-sky-500/30 bg-sky-500/[0.03]"
            onOpenModal={onOpenModal}
            defaultCollapsed={true}
          />
        ) : block.type === "file-context" ? (
          <FileContextBlock key={i} block={block} />
        ) : null,
      )}
      {renderReadTools()}
    </div>
  );
}
