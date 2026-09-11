import { useMemo, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { Message } from "../hooks/types";
import { shouldShowStepContent } from "../utils/toolDisplay";
import { splitReasoning } from "../utils/reasoningChunks";
import { MarkdownContent } from "./ui/MarkdownContent";
import { ToolCallList } from "./tool-renderers/ToolCallList";

// An ever-growing reasoning block. While the session is active and this message
// holds the most recent reasoning the header reads "Thinking" with a spinner;
// once done it reads "Thought <seconds>" (how long that chunk spent thinking).
// The newest chunk hangs beneath the folded parent as a muted quoted block.
// Expanding the parent shows every chunk.
function ThinkingBlock({
  reasoning,
  live,
  reasoningAt,
  timestamp,
}: {
  reasoning: string;
  live?: boolean;
  reasoningAt?: string;
  timestamp?: string;
}) {
  const chunks = useMemo(() => splitReasoning(reasoning), [reasoning]);
  const [open, setOpen] = useState(false);

  if (!reasoning) return null;
  const parentChunks = live ? chunks.slice(0, -1) : chunks;
  const liveChunk = live ? chunks[chunks.length - 1] : undefined;
  const shown = live && open ? chunks : parentChunks;
  const thoughtSecs =
    reasoningAt && timestamp
      ? Math.max(
          1,
          Math.round((new Date(reasoningAt).getTime() - new Date(timestamp).getTime()) / 1000),
        )
      : undefined;
  const label = live ? "Thinking" : `Thought${thoughtSecs ? ` ${thoughtSecs}s` : ""}`;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
          {label}
        </button>
        {live && (
          <Loader2
            size={11}
            className="animate-spin text-accent"
            aria-label="thinking in progress"
          />
        )}
      </div>
      {open && (
        <div className="mt-1.5 pl-2.5 border-l-2 border-accent-muted">
          {shown.map((chunk, idx) => (
            <div key={idx} className={idx > 0 ? "mt-2" : ""}>
              <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
                {chunk}
              </div>
            </div>
          ))}
        </div>
      )}
      {!open && liveChunk && (
        <div className="mt-1.5 pl-2.5 border-l-2 border-accent-muted">
          <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
            {liveChunk}
          </div>
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
      <ThinkingBlock
        reasoning={reasoning}
        live={live}
        reasoningAt={message.reasoningAt}
        timestamp={message.timestamp}
      />
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
