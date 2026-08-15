import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { CirclePlus, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import type { Session, Message } from "../hooks/types";

import { SystemReminderView } from "./SystemReminderView";
import { ScrollMarkers } from "./ScrollMarkers";
import { PinnedPromptBar } from "./PinnedPromptBar";
import { MessageBlock } from "./MessageBlock";
import { LatestThinkingBar } from "./LatestThinkingBar";

import { useConversationScroll } from "../hooks/useConversationScroll";
import { useConversationJumps } from "../hooks/useConversationJumps";
import { useSearchHighlight } from "../hooks/useSearchHighlight";
import { useNavigation } from "../hooks/useNavigation";

import { groupMessages } from "../utils/conversationGrouping";
import { isMessageStreaming, latestThinkingChunk } from "../utils/messageStreaming";
import { relativeTime } from "../utils/sessionUtils";
import { Spinner } from "./ui/Spinner";

// Split-button for the scroll-to-bottom control (Q15): the primary action
// smooth-scrolls to the bottom, the second down-arrow toggles persistent Tail
// mode. Tail is a soft lock — scrolling up disarms it — and survives re-renders
// until the user walks away, so live streaming keeps the newest messages in
// view. Tail only makes sense for live sessions: when the session is not active
// we render a single scroll-to-bottom button (the tail half is hidden
// entirely). The visible "tailing" indicator is the animated line above the
// prompt bar, not the button itself.
function TailSplitButton({
  tailActive,
  canTail,
  onScrollToBottom,
  onToggleTail,
}: {
  tailActive: boolean;
  canTail: boolean;
  onScrollToBottom: () => void;
  onToggleTail: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [menuOpen]);

  if (!canTail) {
    return (
      <div className="relative pointer-events-auto">
        <div className="flex items-center rounded-md bg-ov-bg-secondary border border-ov-border shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={onScrollToBottom}
            className="size-7 flex items-center justify-center text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover transition-colors cursor-pointer"
            title="Scroll to bottom"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative pointer-events-auto">
      <div
        className={`flex items-center rounded-md bg-ov-bg-secondary border shadow-sm overflow-hidden transition-colors ${
          tailActive ? "border-accent" : "border-ov-border"
        }`}
      >
        <button
          type="button"
          onClick={onScrollToBottom}
          className={`size-7 flex items-center justify-center transition-colors cursor-pointer ${
            tailActive
              ? "text-accent hover:text-accent"
              : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
          }`}
          title={tailActive ? "Scrolling with live tail" : "Scroll to bottom"}
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={`flex items-center justify-center border-l transition-colors cursor-pointer ${
            tailActive
              ? "border-accent/50 bg-accent text-white hover:bg-accent"
              : "border-ov-border text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
          }`}
          title={tailActive ? "Tail mode: on" : "Tail mode"}
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {menuOpen && (
        <div className="absolute right-0 bottom-full mb-1 z-[100] min-w-[150px] bg-surface-elevated border border-ov-border rounded-lg shadow-xl py-1">
          <button
            type="button"
            onClick={() => {
              onToggleTail();
              setMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-ov-bg-hover ${
              tailActive ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"
            }`}
          >
            <ChevronDown size={12} />
            <span className="flex-1 text-left">
              {tailActive ? "Stop tailing" : "Tail live session"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function SubAgentHubView({ childSessions }: { childSessions: Session[] }) {
  const { navigateToSession } = useNavigation();

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
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  searchHighlightQuery?: string;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}) {
  const { focusPosition, focusMessageIndex, focusMessageKey, focusMessageId, clearFocus } =
    useNavigation();
  const firstMessage = messages[0];
  const tail = messages.slice(1);
  const { grouped, ownerByRawIndex } = useMemo(() => groupMessages(messages.slice(1)), [messages]);

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

  const {
    scrollRef,
    registry,
    registryVersion,
    markerPositions,
    suppressUserScrollRef,
    showScrollTop,
    showScrollBottom,
    scrollToTop,
    scrollToBottom,
    tailActive,
    enterTail,
    exitTail,
    scrollToRendered,
  } = useConversationScroll({
    sessionId: session.id,
    messageCount: messages.length,
    messages: messagesWithoutReminders,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    searchHighlightQuery,
  });

  useConversationJumps({
    scrollRef,
    registry,
    registryVersion,
    messageCount: messagesWithoutReminders.length,
    focusMessageKey,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    renderIndexResolver: resolveRenderIndex,
    onClearFocus: clearFocus,
    suppressUserScrollRef,
    scrollToRendered,
  });

  // Tail mode only makes sense while the session is live: if the session stops
  // being active (e.g. the agent finished) while we are tailing, exit so the
  // view is not pinned to a bottom that will never move again.
  const isActive = session.status === "active";
  useEffect(() => {
    if (!isActive && tailActive) exitTail();
  }, [isActive, tailActive, exitTail]);

  const hasFocusJump =
    focusPosition !== undefined || focusMessageIndex !== undefined || focusMessageId !== undefined;

  // Reasoning only grows on the message the model is currently writing, so the
  // streaming indicator targets that single message rather than the whole
  // session (agents without step events fall back to the last assistant turn).
  const lastAssistantIndex = useMemo(() => {
    let last = -1;
    messagesWithoutReminders.forEach((m, i) => {
      if (m.role === "assistant") last = i;
    });
    return last;
  }, [messagesWithoutReminders]);

  const latestThinking = useMemo(
    () => latestThinkingChunk(messagesWithoutReminders, isActive),
    [messagesWithoutReminders, isActive],
  );

  useSearchHighlight(
    scrollRef,
    searchHighlightQuery,
    messagesWithoutReminders,
    scrollToRendered,
    hasFocusJump,
  );

  const handleMarkerClick = useCallback(
    (markerId: string) => {
      const match = /^msg-(\d+)$/.exec(markerId);
      if (match) scrollToRendered(parseInt(match[1], 10), "center");
    },
    [scrollToRendered],
  );

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
          <>
            {latestThinking && <LatestThinkingBar chunk={latestThinking.chunk} />}
            <PinnedPromptBar
              session={session}
              firstMessage={firstMessage}
              onOpenModal={onOpenModal}
              onQueueChanged={onQueueChanged}
              highlightPromptId={highlightPromptId}
              onHighlightDone={onHighlightDone}
              tailActive={tailActive}
            />
          </>
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
                  live={isMessageStreaming(msg, idx === lastAssistantIndex, isActive)}
                />
              </div>
            ))
          )}
        </div>

        {showScrollBottom && (
          <div className="absolute bottom-0 right-14 z-20 pb-3 pointer-events-none">
            <TailSplitButton
              tailActive={tailActive}
              canTail={isActive}
              onScrollToBottom={scrollToBottom}
              onToggleTail={tailActive ? exitTail : enterTail}
            />
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
          markerPositions={markerPositions}
          onMarkerClick={handleMarkerClick}
        />
      </div>

      {!session.parentId && (
        <>
          {latestThinking && <LatestThinkingBar chunk={latestThinking.chunk} />}
          <PinnedPromptBar
            session={session}
            firstMessage={firstMessage}
            onOpenModal={onOpenModal}
            onQueueChanged={onQueueChanged}
            highlightPromptId={highlightPromptId}
            onHighlightDone={onHighlightDone}
            tailActive={tailActive}
          />
        </>
      )}
    </div>
  );
}
