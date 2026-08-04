import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { Session, Message } from "../hooks/types";
import { fetchMessages } from "../hooks/apiClient";
import { isAbortError } from "../utils/errors";
import { useToast } from "../hooks/useToast";
import { MarkdownContent } from "./MarkdownContent";
import { Modal } from "./Modal";
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

interface SessionViewerProps {
  session: Session;
  childSessions?: Session[];
  liveChangedIds: Set<string>;
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
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  searchHighlightQuery?: string | null;
  onNavigateToMessage?: (messageIndex: number) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
}

export function SessionViewer({
  session,
  childSessions,
  liveChangedIds,
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

  const cancelLoadRef = useRef<AbortController | null>(null);

  const loadMessages = useCallback(() => {
    cancelLoadRef.current?.abort();
    const controller = new AbortController();
    cancelLoadRef.current = controller;
    setLoading(true);
    fetchMessages(session.id, controller.signal)
      .then((data) => {
        setMessages(data || []);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        showErrorToast(err, "Failed to load messages");
        setMessages([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, [session.id, showErrorToast]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!liveChangedIds.has(session.id)) return;
    const handle = setTimeout(() => {
      loadMessages();
      setRefreshKey((k) => k + 1);
    }, 300);
    return () => clearTimeout(handle);
  }, [liveChangedIds, session.id, loadMessages]);

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
            onOpenModal={(content, title) => setMarkdownModal({ content, title })}
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
              />
            </div>
          </div>
        )}
        {(summaryLoaded || activeTab === "summary") && (
          <div className={`absolute inset-0 ${activeTab !== "summary" ? "hidden" : ""}`}>
            <SessionSummary session={session} messages={messages} />
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
