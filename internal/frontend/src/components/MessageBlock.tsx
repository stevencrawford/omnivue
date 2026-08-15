import { memo, useState } from "react";
import { ChevronDown, ChevronUp, Info, TriangleAlert } from "lucide-react";

import type { Message } from "../hooks/types";
import { MarkdownContent } from "./ui/MarkdownContent";
import { SystemReminderView } from "./SystemReminderView";
import { UserTurnView } from "./UserTurnMessage";
import { AssistantMessageView } from "./AssistantMessage";

function SystemReminderInline({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-gray-500/20" />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap hover:text-gray-300 transition-colors cursor-pointer"
        >
          <Info size={12} className="text-gray-400 shrink-0" />
          <span>SYSTEM REMINDER</span>
          {expanded ? (
            <ChevronUp size={10} className="text-gray-400" />
          ) : (
            <ChevronDown size={10} className="text-gray-400" />
          )}
        </button>
        <div className="flex-1 h-px bg-gray-500/20" />
      </div>
      {expanded && (
        <div className="mt-1 pl-1">
          <MarkdownContent content={content} className="markdown-body--wide" />
        </div>
      )}
    </div>
  );
}

interface MessageBlockProps {
  message: Message;
  messageIndex: number;
  sessionId: string;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
}

export const MessageBlock = memo(function MessageBlock({
  message,
  sessionId,
  onOpenModal,
  onPin,
  onBookmark,
  bookmarkIdByRef,
}: MessageBlockProps) {
  const msgKey = `${sessionId}:${message.id}:`;
  const isMsgBookmarked = bookmarkIdByRef ? !!bookmarkIdByRef[msgKey] : false;

  if (message.role === "user") {
    if (!message.content?.trim()) return null;
    const turnAborted = message.metadata?.type === "turn_aborted";
    if (turnAborted) {
      return (
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-red-500/20" />
          <div className="flex items-center gap-1.5 shrink-0">
            <TriangleAlert size={12} className="text-red-400" />
            <span
              className="text-[10px] font-semibold text-red-400 uppercase tracking-wider select-none"
              title={message.content}
            >
              TURN ABORTED
            </span>
          </div>
          <div className="flex-1 h-px bg-red-500/20" />
        </div>
      );
    }
    const isInlineReminder = message.metadata?.type === "system_reminder_inline";
    if (isInlineReminder) {
      return <SystemReminderInline content={message.content} />;
    }
    return (
      <UserTurnView
        content={message.content}
        toolCalls={message.toolCalls}
        sessionId={sessionId}
        messageId={message.id}
        onOpenModal={onOpenModal}
        onPin={onPin}
        onBookmark={onBookmark}
        isBookmarked={isMsgBookmarked}
        bookmarkIdByRef={bookmarkIdByRef}
      />
    );
  }
  if (message.role === "system") {
    if (!message.content?.trim()) return null;
    const isReminder = message.metadata?.type === "system_reminder";
    if (isReminder) {
      return (
        <SystemReminderView
          content={message.content}
          fileName={message.metadata?.file || "AGENTS.md"}
        />
      );
    }
    return <div className="sess-system-notice whitespace-pre-wrap">{message.content}</div>;
  }
  return (
    <>
      {message.error && (
        <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-red-500/20">
            <TriangleAlert size={14} className="text-red-400 shrink-0" />
            <span className="text-[11px] font-semibold text-red-400">API ERROR</span>
          </div>
          <div className="px-3 py-2 text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed">
            {message.error}
          </div>
        </div>
      )}
      <AssistantMessageView
        message={message}
        sessionId={sessionId}
        onOpenModal={onOpenModal}
        onPin={onPin}
        onBookmark={onBookmark}
        isMsgBookmarked={isMsgBookmarked}
        bookmarkIdByRef={bookmarkIdByRef}
      />
    </>
  );
});
