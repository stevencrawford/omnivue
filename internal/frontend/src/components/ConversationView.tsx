import { useMemo, useState, useEffect } from "react";
import { CirclePlus, ChevronDown, ChevronUp, TriangleAlert, ArrowRight } from "lucide-react";
import type { Session, Message } from "../hooks/useApi";
import { shouldShowStepContent } from "../utils/toolDisplay";

import { SystemReminderView } from "./SystemReminderView";
import { UserTurnView } from "./UserTurnMessage";
import { AssistantMessageView } from "./AssistantMessage";
import { ScrollMarkers } from "./ScrollMarkers";
import { PinnedPromptBar } from "./PinnedPromptBar";

import { useConversationScroll } from "../hooks/useConversationScroll";
import { useSearchHighlight } from "../hooks/useSearchHighlight";
import { useSessionNav } from "../hooks/useNav";

import { relativeTime } from "../utils/sessionUtils";

function groupMessages(messages: Message[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0 && !shouldShowStepContent(msg.content ?? "", tools)) {
        const last = result[result.length - 1];
        if (last && last.role === "assistant" && last.toolCalls && last.toolCalls.length > 0) {
          last.toolCalls = [...last.toolCalls, ...tools];
          if (msg.reasoning) {
            last.reasoning = last.reasoning
              ? last.reasoning + "\n\n" + msg.reasoning
              : msg.reasoning;
          }
          continue;
        }
        // Merge tool-call message into the preceding reasoning-only assistant message
        if (
          last &&
          last.role === "assistant" &&
          last.reasoning &&
          (!last.toolCalls || last.toolCalls.length === 0)
        ) {
          last.toolCalls = tools;
          if (msg.reasoning) {
            last.reasoning = last.reasoning + "\n\n" + msg.reasoning;
          }
          continue;
        }
      }
    }
    result.push({ ...msg, toolCalls: msg.toolCalls ? [...msg.toolCalls] : undefined });
  }
  return result;
}

function SubAgentHubView({ childSessions }: { childSessions: Session[] }) {
  const { navigateToSession } = useSessionNav();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 relative min-h-0 overflow-y-auto py-4 px-4">
        <div className="max-w-lg mx-auto">
          <p className="text-sm text-ov-text-secondary mb-4">
            This session delegated work to <strong>{childSessions.length}</strong> sub-agent
            {childSessions.length > 1 ? "s" : ""}. Select one to view its conversation.
          </p>
          <div className="space-y-1">
            {childSessions.map((cs) => (
              <button
                key={cs.id}
                type="button"
                onClick={() => navigateToSession(cs.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-ov-bg-hover transition-colors cursor-pointer border border-ov-border"
              >
                <ArrowRight size={14} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-ov-text truncate">
                    {cs.subAgent ? (
                      <span className="text-ov-text-secondary">{cs.subAgent}: </span>
                    ) : null}
                    {cs.title || cs.id.slice(0, 12)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-ov-text-secondary">
                      {cs.messageCount} message{cs.messageCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-[11px] text-ov-text-secondary">
                      {relativeTime(cs.updatedAt)}
                    </span>
                    <span
                      className={`text-[11px] capitalize ${cs.status === "active" ? "text-green-500" : "text-ov-text-secondary"}`}
                    >
                      {cs.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConversationView({
  messages,
  session,
  loading,
  childSessions,
  onOpenModal,
  onPin,
  onBookmark,
  bookmarkIdByRef,
  focusStepIndex,
  searchHighlightQuery,
  focusMessageIndex,
  focusMessageKey,
  focusMessageId,
  onClearFocus,
}: {
  messages: Message[];
  session: Session;
  loading: boolean;
  childSessions?: Session[];
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  focusStepIndex?: number;
  searchHighlightQuery?: string;
  focusMessageIndex?: number;
  focusMessageKey?: number;
  focusMessageId?: string;
  onClearFocus?: () => void;
}) {
  const { scrollRef, showScrollTop, showScrollBottom, scrollToTop, scrollToBottom } =
    useConversationScroll({
      sessionId: session.id,
      messageCount: messages.length,
      focusMessageIndex,
      searchHighlightQuery,
    });

  const [markerPositions, setMarkerPositions] = useState<Record<string, number>>({});

  const firstMessage = messages[0];
  const tail = messages.slice(1);
  const grouped = useMemo(() => groupMessages(tail), [tail]);

  const systemReminders = useMemo(
    () => messages.filter((m) => m.role === "system" && m.metadata?.type === "system_reminder"),
    [messages],
  );
  const messagesWithoutReminders = useMemo(
    () => grouped.filter((m) => m.role !== "system" || m.metadata?.type !== "system_reminder"),
    [grouped],
  );

  useSearchHighlight(
    scrollRef,
    searchHighlightQuery,
    focusStepIndex,
    focusMessageIndex,
    focusMessageKey,
    focusMessageId,
    messagesWithoutReminders,
    onClearFocus,
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const positions: Record<string, number> = {};
    const total = container.scrollHeight || 1;
    const els = container.querySelectorAll("[data-marker-id]");
    els.forEach((el) => {
      const id = el.getAttribute("data-marker-id");
      if (!id) return;
      positions[id] = ((el as HTMLElement).offsetTop / total) * 100;
    });
    setMarkerPositions(positions);
  }, [messagesWithoutReminders.length, scrollRef]);

  const showLoadingOverlay = loading && messages.length === 0;

  if (!loading && messages.length === 0) {
    if (childSessions && childSessions.length > 0) {
      return <SubAgentHubView childSessions={childSessions} />;
    }
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 relative min-h-0 flex items-center justify-center">
          <div className="sess-empty-state">
            <div className="sess-empty-icon">
              <CirclePlus size={20} />
            </div>
            <p className="text-sm text-ov-text-secondary">No messages in this session</p>
          </div>
        </div>
        <PinnedPromptBar session={session} firstMessage={firstMessage} onOpenModal={onOpenModal} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 relative min-h-0">
        {showLoadingOverlay && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-ov-bg">
            <div className="flex items-center gap-2 text-sm text-ov-text-secondary">
              <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Loading conversation...
            </div>
          </div>
        )}
        <div
          ref={scrollRef}
          className="absolute inset-0 right-7 overflow-y-auto overflow-x-hidden py-3"
        >
          {systemReminders.length > 0 && (
            <div className="px-4 pb-2">
              {systemReminders.map((msg) => (
                <SystemReminderView
                  key={msg.id}
                  content={msg.content}
                  fileName={msg.metadata?.file || "AGENTS.md"}
                  onOpenModal={onOpenModal}
                />
              ))}
            </div>
          )}
          {messagesWithoutReminders.length === 0 ? (
            <p className="text-center text-xs text-ov-text-secondary py-8">
              Agent work appears here as tools run and responses stream in.
            </p>
          ) : (
            messagesWithoutReminders.map((msg, idx) => (
              <div
                key={msg.id}
                data-marker-id={`msg-${idx}`}
                data-message-index={idx}
                data-message-id={msg.id}
              >
                <MessageBlock
                  message={msg}
                  messageIndex={idx}
                  onOpenModal={onOpenModal}
                  onPin={onPin}
                  onBookmark={onBookmark}
                  bookmarkIdByRef={bookmarkIdByRef}
                  sessionId={session.id}
                />
              </div>
            ))
          )}
        </div>

        {showScrollBottom && (
          <div className="absolute bottom-0 right-14 z-20 pb-3 pointer-events-none">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto size-7 flex items-center justify-center rounded-md bg-ov-bg-secondary border border-ov-border text-ov-text-secondary hover:text-ov-text hover:border-accent-border transition-colors cursor-pointer shadow-sm"
              title="Scroll to bottom"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}

        {showScrollTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="absolute top-2 right-14 z-20 size-7 flex items-center justify-center rounded-md bg-ov-bg-secondary border border-ov-border text-ov-text-secondary hover:text-ov-text hover:border-accent-border transition-colors cursor-pointer shadow-sm"
            title="Scroll to top"
          >
            <ChevronUp size={14} />
          </button>
        )}

        <ScrollMarkers
          messages={messagesWithoutReminders}
          scrollRef={scrollRef}
          markerPositions={markerPositions}
        />
      </div>

      <PinnedPromptBar session={session} firstMessage={firstMessage} onOpenModal={onOpenModal} />
    </div>
  );
}

function MessageBlock({
  message,
  messageIndex,
  sessionId,
  onOpenModal,
  onPin,
  onBookmark,
  bookmarkIdByRef,
}: {
  message: Message;
  messageIndex: number;
  sessionId: string;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
}) {
  const msgKey = `${sessionId}:${messageIndex}:`;
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
    return (
      <UserTurnView
        content={message.content}
        toolCalls={message.toolCalls}
        sessionId={sessionId}
        messageIndex={messageIndex}
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
          onOpenModal={onOpenModal}
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
        messageIndex={messageIndex}
        onOpenModal={onOpenModal}
        onPin={onPin}
        onBookmark={onBookmark}
        isMsgBookmarked={isMsgBookmarked}
        bookmarkIdByRef={bookmarkIdByRef}
      />
    </>
  );
}
