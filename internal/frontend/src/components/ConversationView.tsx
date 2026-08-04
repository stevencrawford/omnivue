import { useMemo, useState, useEffect, useCallback } from "react";
import { CirclePlus, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import type { Session, Message } from "../hooks/useApi";

import { SystemReminderView } from "./SystemReminderView";
import { ScrollMarkers } from "./ScrollMarkers";
import { PinnedPromptBar } from "./PinnedPromptBar";
import { MessageBlock } from "./MessageBlock";

import { useConversationScroll } from "../hooks/useConversationScroll";
import { useSearchHighlight } from "../hooks/useSearchHighlight";
import { useSessionNav } from "../hooks/useNav";
import { useFocus } from "../hooks/useFocus";

import { groupMessages } from "../utils/conversationGrouping";
import { relativeTime } from "../utils/sessionUtils";
import { Spinner } from "./Spinner";

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
  searchHighlightQuery,
  onQueueChanged,
  highlightPromptId,
  onHighlightDone,
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
  searchHighlightQuery?: string;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}) {
  const { focusStepIndex, focusMessageIndex, focusMessageKey, focusMessageId, clearFocus } =
    useFocus();
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
  const { grouped, ownerByRawIndex } = useMemo(() => groupMessages(tail), [tail]);

  const systemReminders = useMemo(
    () => messages.filter((m) => m.role === "system" && m.metadata?.type === "system_reminder"),
    [messages],
  );
  const messagesWithoutReminders = useMemo(
    () => grouped.filter((m) => m.role !== "system" || m.metadata?.type !== "system_reminder"),
    [grouped],
  );

  // Map raw message positions/ids to the rendered block index in
  // messagesWithoutReminders. Assistant tool-call messages that are merged into
  // a previous message resolve to the block they were absorbed into, so
  // notifications (which carry raw messageIndex/messageId) can always find the
  // correct rendered element.
  const renderedIndexByRaw = useMemo(() => {
    const groupedIdxToRendered = new Map<number, number>();
    grouped.forEach((m, gi) => {
      if (m.role !== "system" || m.metadata?.type !== "system_reminder") {
        groupedIdxToRendered.set(gi, groupedIdxToRendered.size);
      }
    });
    const byIndex = new Map<number, number>();
    const byId = new Map<string, number>();
    ownerByRawIndex.forEach((ownerGroupedIdx, ti) => {
      const rendered = groupedIdxToRendered.get(ownerGroupedIdx);
      if (rendered === undefined) return;
      byIndex.set(ti + 1, rendered);
      const msg = tail[ti];
      if (msg?.id) byId.set(msg.id, rendered);
    });
    messagesWithoutReminders.forEach((m, ri) => {
      if (m.id) byId.set(m.id, ri);
    });
    return { byIndex, byId };
  }, [grouped, ownerByRawIndex, messagesWithoutReminders, tail]);

  const resolveRenderIndex = useCallback(
    (rawIndex: number | undefined, messageId: string | undefined): number | undefined => {
      if (messageId !== undefined) {
        const viaId = renderedIndexByRaw.byId.get(messageId);
        if (viaId !== undefined) return viaId;
      }
      if (rawIndex !== undefined) return renderedIndexByRaw.byIndex.get(rawIndex);
      return undefined;
    },
    [renderedIndexByRaw],
  );

  useSearchHighlight(
    scrollRef,
    searchHighlightQuery,
    focusStepIndex,
    focusMessageIndex,
    focusMessageKey,
    focusMessageId,
    messagesWithoutReminders,
    clearFocus,
    resolveRenderIndex,
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
        {!session.parentId && (
          <PinnedPromptBar
            session={session}
            firstMessage={firstMessage}
            onOpenModal={onOpenModal}
            onQueueChanged={onQueueChanged}
            highlightPromptId={highlightPromptId}
            onHighlightDone={onHighlightDone}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 relative min-h-0">
        {showLoadingOverlay && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-ov-bg">
            <div className="flex items-center gap-2 text-sm text-ov-text-secondary">
              <Spinner />
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

      {!session.parentId && (
        <PinnedPromptBar
          session={session}
          firstMessage={firstMessage}
          onOpenModal={onOpenModal}
          onQueueChanged={onQueueChanged}
          highlightPromptId={highlightPromptId}
          onHighlightDone={onHighlightDone}
        />
      )}
    </div>
  );
}
