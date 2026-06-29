import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Message } from "../hooks/useApi";
import { shouldShowStepContent } from "../utils/toolDisplay";
import { MarkdownContent } from "./MarkdownContent";
import { ToolCallList } from "./ToolRenderers/ToolCallList";

function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!reasoning) return null;
  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight size={14} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        {expanded ? "Hide thinking" : "Show thinking"}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-2.5 border-l-2 border-accent-muted">
          <div className="text-xs text-gh-text-secondary whitespace-pre-wrap leading-relaxed">
            {reasoning}
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
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n\u2026" : content;

  return (
    <div>
      <MarkdownContent
        content={display}
        className="markdown-body--wide"
        onOpenModal={() => onOpenModal?.(content, "Assistant response")}
        onPin={onPin ? () => onPin(content) : undefined}
        onBookmark={onBookmark}
        isBookmarked={isBookmarked}
        modalTitle="Assistant response"
      />
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
  messageIndex,
  onOpenModal,
  onPin,
  onBookmark,
  isMsgBookmarked,
  bookmarkIdByRef,
}: {
  message: Message;
  sessionId: string;
  messageIndex: number;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  isMsgBookmarked?: boolean;
  bookmarkIdByRef?: Record<string, string>;
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
      <ThinkingBlock reasoning={reasoning} />
      {showText && (
        <AssistantStepContent
          content={text}
          onOpenModal={onOpenModal}
          onPin={onPin}
          onBookmark={
            onBookmark
              ? () => onBookmark(sessionId, messageIndex, undefined, text.slice(0, 80))
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
            compact
            onOpenModal={onOpenModal}
            onPin={onPin}
            onBookmark={
              onBookmark
                ? (toolCallId: string, label: string) =>
                    onBookmark(sessionId, messageIndex, toolCallId, label)
                : undefined
            }
            bookmarkIdByRef={bookmarkIdByRef}
            sessionId={sessionId}
            messageIndex={messageIndex}
          />
        </div>
      )}
    </div>
  );
}
