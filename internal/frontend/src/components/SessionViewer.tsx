import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Session, Message, BookmarkKind } from "../hooks/types";
import { fetchMessages } from "../hooks/apiClient";
import { isAbortError } from "../utils/errors";
import { useToast } from "../hooks/useToast";
import { MarkdownContent } from "./ui/MarkdownContent";
import { Modal } from "./ui/Modal";
import { MarkdownScreenshotButton } from "./MarkdownScreenshotButton";
import { useCopy } from "../hooks/useCopy";
import { DiffView } from "./DiffView";
import { PlanView } from "./PlanView";
import { ScratchEditor } from "./ScratchEditor";
import { TodosView } from "./TodosView";
import { TerminalPanel } from "./TerminalPanel";
import { SessionHeader } from "./SessionHeader";
import { ConversationView } from "./ConversationView";
import { SessionSummary } from "./SessionSummary";
import { SessionTabBar } from "./SessionTabBar";

export type Tab =
  | "session"
  | "diff"
  | "plan"
  | "summary"
  | "todos"
  | "terminal"
  | `scratch:${string}`;

/**
 * Reconcile a fresh message list against the previously rendered one so that
 * unchanged messages keep their object identity. MessageBlock is memoized, so
 * preserving identity prevents needless re-renders (and markdown re-parsing)
 * on every SSE poll. Returns `prev` unchanged when nothing differs.
 */
export function reconcileMessages(prev: Message[], next: Message[]): Message[] {
  if (prev.length === 0 || next.length === 0 || prev.length !== next.length) {
    return next;
  }
  const prevById = new Map(prev.map((m) => [m.id, m]));
  let same = true;
  const merged = next.map((m) => {
    const old = prevById.get(m.id);
    if (old && messagesEqual(old, m)) return old;
    same = false;
    return m;
  });
  return same ? prev : merged;
}

function messagesEqual(a: Message, b: Message): boolean {
  if (
    a.id !== b.id ||
    a.role !== b.role ||
    a.content !== b.content ||
    a.reasoning !== b.reasoning ||
    a.error !== b.error ||
    a.model !== b.model
  ) {
    return false;
  }
  if (JSON.stringify(a.metadata ?? null) !== JSON.stringify(b.metadata ?? null)) {
    return false;
  }
  const ta = a.toolCalls ?? [];
  const tb = b.toolCalls ?? [];
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i];
    const y = tb[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.status !== y.status ||
      x.input !== y.input ||
      x.output !== y.output ||
      x.duration !== y.duration ||
      JSON.stringify(x.metadata ?? null) !== JSON.stringify(y.metadata ?? null)
    ) {
      return false;
    }
  }
  return true;
}

interface SessionViewerProps {
  session: Session;
  childSessions?: Session[];
  liveChangedIds: Set<string>;
  /** Acknowledge a live-change notification for this session as handled. */
  ackSessionChange?: (id: string) => void;
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  onNameChanged?: () => void;
  openScratchTabs: string[];
  scratchFileMap: Record<string, { title: string; mode: string; sessionId: string }>;
  onCloseScratchTab: (fileId: string) => void;
  onNewScratchFile?: () => void;
  onRenameScratchFile?: (fileId: string, newTitle: string) => void;
  onPinMessage?: (content: string) => void;
  onBookmark?: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
    kind?: BookmarkKind,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  searchHighlightQuery?: string | null;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}

export function SessionViewer({
  session,
  childSessions,
  liveChangedIds,
  ackSessionChange,
  activeTab: activeTabProp,
  onTabChange,
  onNameChanged,
  openScratchTabs,
  scratchFileMap,
  onCloseScratchTab,
  onNewScratchFile,
  onRenameScratchFile,
  onPinMessage,
  onBookmark,
  bookmarkIdByRef,
  searchHighlightQuery,
  onNavigateToMessage,
  onQueueChanged,
  highlightPromptId,
  onHighlightDone,
}: SessionViewerProps) {
  const [localTab, setLocalTab] = useState<Tab>("session");
  const activeTab = activeTabProp ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const { showErrorToast } = useToast();

  // Tracks the in-flight message request. Only the newest request may write
  // messages or clear loading; a request superseded by a newer one or aborted
  // on unmount must not clobber the fresher state.
  const loadRef = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });

  const loadMessages = useCallback(async () => {
    const id = loadRef.current.id + 1;
    loadRef.current.controller?.abort();
    const controller = new AbortController();
    loadRef.current = { id, controller };
    setLoading(true);
    try {
      const data = await fetchMessages(session.id, controller.signal);
      if (loadRef.current.id !== id) return;
      setMessages((prev) => reconcileMessages(prev, data || []));
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      if (loadRef.current.id !== id) return;
      showErrorToast(err, "Failed to load messages");
      setMessages([]);
    } finally {
      if (loadRef.current.id === id) setLoading(false);
    }
  }, [session.id, showErrorToast]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    return () => {
      loadRef.current.controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!liveChangedIds.has(session.id)) return;
    // A deep link mounts this view with a slow full-transcript fetch in flight;
    // interrupting it on a live SSE event strands the spinner. Let the initial
    // load finish untouched and leave the change pending so this effect re-runs
    // and applies it once the load completes; acking here would drop it.
    if (messages.length === 0 && loading) return;
    const handle = setTimeout(() => {
      ackSessionChange?.(session.id);
      loadMessages();
      setRefreshKey((k) => k + 1);
    }, 300);
    return () => clearTimeout(handle);
  }, [liveChangedIds, session.id, loadMessages, messages.length, loading, ackSessionChange]);

  const messageCount = useMemo(() => {
    const user = messages.filter((m) => m.role === "user").length;
    const assistant = messages.filter((m) => m.role === "assistant").length;
    return { user, assistant, total: messages.length };
  }, [messages]);

  const hasPrivacy = useMemo(
    () => messages.some((m) => m.metadata?.privacy === "true"),
    [messages],
  );

  useEffect(() => {
    if (activeTab.startsWith("scratch:") && !openScratchTabs.includes(activeTab.slice(8))) {
      setActiveTab("session");
    }
  }, [activeTab, openScratchTabs]);

  const isScratchTab = (tab: Tab): tab is `scratch:${string}` => tab.startsWith("scratch:");
  const scratchFileIdFromTab = (tab: Tab): string | null =>
    isScratchTab(tab) ? tab.slice(8) : null;

  const handleOpenModal = useCallback((content: string, title?: string) => {
    setMarkdownModal({ content, title });
  }, []);

  return (
    <div className="flex flex-col h-full">
      <SessionHeader session={session} hasPrivacy={hasPrivacy} onNameChanged={onNameChanged} />

      <SessionTabBar
        session={session}
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === "diff") setDiffLoaded(true);
          if (tab === "plan") setPlanLoaded(true);
          if (tab === "summary") setSummaryLoaded(true);
          setActiveTab(tab);
        }}
        openScratchTabs={openScratchTabs}
        scratchFileMap={scratchFileMap}
        onCloseScratchTab={onCloseScratchTab}
        onNewScratchFile={onNewScratchFile}
        onRenameScratchFile={onRenameScratchFile}
        messageCount={messageCount}
      />

      {/* Tab content — all panels are always mounted, inactive ones hidden */}
      <div className="relative flex-1 min-h-0">
        <div className={`absolute inset-0 ${activeTab !== "session" ? "hidden" : "flex flex-col"}`}>
          <ConversationView
            messages={messages}
            session={session}
            childSessions={childSessions}
            loading={loading}
            onOpenModal={handleOpenModal}
            onPin={onPinMessage}
            onBookmark={onBookmark}
            bookmarkIdByRef={bookmarkIdByRef}
            searchHighlightQuery={searchHighlightQuery ?? undefined}
            onQueueChanged={onQueueChanged}
            highlightPromptId={highlightPromptId}
            onHighlightDone={onHighlightDone}
          />
        </div>
        {(diffLoaded || activeTab === "diff") && (
          <div className={`absolute inset-0 ${activeTab !== "diff" ? "hidden" : ""}`}>
            <div className="h-full overflow-y-auto">
              <DiffView
                sessionId={session.id}
                sessionDirectory={session.directory}
                refreshKey={refreshKey}
                searchHighlightQuery={searchHighlightQuery}
                onNavigateToMessage={onNavigateToMessage}
              />
            </div>
          </div>
        )}
        {(planLoaded || activeTab === "plan") && (
          <div className={`absolute inset-0 ${activeTab !== "plan" ? "hidden" : ""}`}>
            <div className="h-full overflow-y-auto">
              <PlanView
                sessionId={session.id}
                refreshKey={refreshKey}
                searchHighlightQuery={searchHighlightQuery}
                onBookmark={onBookmark}
                bookmarkIdByRef={bookmarkIdByRef}
              />
            </div>
          </div>
        )}
        {(summaryLoaded || activeTab === "summary") && (
          <div className={`absolute inset-0 ${activeTab !== "summary" ? "hidden" : ""}`}>
            <SessionSummary
              session={session}
              messages={messages}
              loading={loading}
              onNavigateToMessage={onNavigateToMessage}
            />
          </div>
        )}
        {activeTab === "todos" && session.todos && (
          <div className="absolute inset-0">
            <TodosView todos={session.todos} />
          </div>
        )}
        {activeTab === "terminal" && !session.parentId && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            <TerminalPanel sessionId={session.id} />
          </div>
        )}
        {isScratchTab(activeTab) &&
          (() => {
            const fid = scratchFileIdFromTab(activeTab)!;
            const info = scratchFileMap[fid];
            const scratchSessionId = info?.sessionId || session.id;
            return (
              <div className="absolute inset-0 flex flex-col">
                <ScratchEditor
                  key={fid}
                  sessionId={scratchSessionId}
                  fileId={fid}
                  onDelete={() => onCloseScratchTab(fid)}
                />
              </div>
            );
          })()}
      </div>

      {/* Markdown modal */}
      <Modal
        isOpen={markdownModal !== null}
        onClose={() => setMarkdownModal(null)}
        title={markdownModal?.title}
        size="xl"
      >
        {markdownModal && (
          <ModalMarkdownWrapper content={markdownModal.content} title={markdownModal.title} />
        )}
      </Modal>
    </div>
  );
}

function ModalMarkdownWrapper({ content, title }: { content: string; title?: string }) {
  const { copied, copy } = useCopy(2000);
  return (
    <div className="relative group">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <MarkdownScreenshotButton content={content} title={title} />
        <button
          type="button"
          onClick={() => copy(content)}
          className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>
      <MarkdownContent content={content} className="markdown-body--wide" />
    </div>
  );
}
