import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Message } from "../hooks/types";
import { shouldShowStepContent } from "../utils/toolDisplay";
import { splitReasoning } from "../utils/reasoningChunks";
import { MarkdownContent } from "./ui/MarkdownContent";
import { ToolCallList } from "./tool-renderers/ToolCallList";

function ThinkingBlock({ reasoning, live }: { reasoning: string; live?: boolean }) {
  const chunks = useMemo(() => splitReasoning(reasoning), [reasoning]);
  const [open, setOpen] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const autoOpenedRef = useRef(false);

  // While the session is live, keep the section open and auto-expand the newest
  // chunk so streaming thinking is visible instead of one frozen block; collapse
  // back to the header when the session stops streaming.
  useEffect(() => {
    if (live && chunks.length > 0) {
      setOpen(true);
      setExpandedChunks((prev) =>
        prev.has(chunks.length - 1) ? prev : new Set(prev).add(chunks.length - 1),
      );
      autoOpenedRef.current = true;
    } else if (!live && autoOpenedRef.current) {
      setOpen(false);
      autoOpenedRef.current = false;
    }
  }, [live, chunks.length]);

  if (!reasoning) return null;
  const count = chunks.length;
  const label = count > 1 ? `Show thinking · ${count}` : "Show thinking";
  const hideLabel = count > 1 ? `Hide thinking · ${count}` : "Hide thinking";
  const toggleChunk = (idx: number) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {open ? hideLabel : label}
      </button>
      {open && (
        <div className="mt-1.5 pl-2.5 border-l-2 border-accent-muted">
          {chunks.map((chunk, idx) => {
            const expanded = expandedChunks.has(idx);
            const isNewest = idx === count - 1;
            return (
              <div key={idx} className={idx > 0 ? "mt-2" : ""}>
                {count > 1 && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] text-ov-text-secondary hover:text-accent cursor-pointer select-none"
                    onClick={() => toggleChunk(idx)}
                  >
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                    />
                    <span className={live && isNewest ? "animate-pulse" : ""}>
                      Thinking {idx + 1}
                    </span>
                  </button>
                )}
                {expanded && (
                  <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
                    {chunk}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssistantStepContent({
  content,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
}: {
  content: string;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}) {
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <div className={`relative ${!expanded && isLong ? "max-h-[24em] overflow-hidden" : ""}`}>
        {!expanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-ov-bg-secondary)] to-transparent z-10 pointer-events-none" />
        )}
        <MarkdownContent
          content={content}
          className="markdown-body--wide"
          onOpenModal={() => onOpenModal?.(content, "Assistant response")}
          onPin={onPin ? () => onPin(content) : undefined}
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          modalTitle="Assistant response"
        />
      </div>
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function AssistantMessageView({
  message,
  sessionId,
  onOpenModal,
  onPin,
  onBookmark,
  isMsgBookmarked,
  bookmarkIdByRef,
  live,
}: {
  message: Message;
  sessionId: string;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  isMsgBookmarked?: boolean;
  bookmarkIdByRef?: Record<string, string>;
  live?: boolean;
}) {
  const agent = message.agent && message.agent !== "main" ? message.agent : undefined;
  const text = (message.content || "").trim();
  const reasoning = message.reasoning || "";
  const tools = (message.toolCalls ?? []).filter((t) => t.name !== "report_intent");
  if (!text && !reasoning && tools.length === 0) return null;
  const showText = shouldShowStepContent(text, tools);
  if (!showText && !reasoning && tools.length === 0) return null;

  return (
    <div className="sess-agent-stream">
      {agent && (
        <span className="inline-block mb-2 text-[11px] px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border">
          {agent}
        </span>
      )}
      <ThinkingBlock reasoning={reasoning} live={live} />
      {showText && (
        <AssistantStepContent
          content={text}
          onOpenModal={onOpenModal}
          onPin={onPin}
          onBookmark={
            onBookmark
              ? () => onBookmark(sessionId, message.id, undefined, text.slice(0, 80))
              : undefined
          }
          isBookmarked={isMsgBookmarked}
        />
      )}
      {tools.length > 0 && (
        <div className={showText ? "mt-2" : ""}>
          <ToolCallList
            toolCalls={tools}
            agent={agent}
            variant="summary"
            onOpenModal={onOpenModal}
            onPin={onPin}
            onBookmark={
              onBookmark
                ? (toolCallId: string, label: string) =>
                    onBookmark(sessionId, message.id, toolCallId, label)
                : undefined
            }
            bookmarkIdByRef={bookmarkIdByRef}
            sessionId={sessionId}
          />
        </div>
      )}
    </div>
  );
}
