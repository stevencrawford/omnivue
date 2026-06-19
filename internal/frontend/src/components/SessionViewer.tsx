import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, Message } from "../hooks/useApi";
import { fetchMessages } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";
import { Modal } from "./Modal";
import { DiffView } from "./DiffView";
import { PlanView } from "./PlanView";
import { ScratchEditor } from "./ScratchEditor";
import { SessionHeader } from "./SessionHeader";
import { ConversationView } from "./ConversationView";

export type Tab = "session" | "diff" | "plan" | `scratch:${string}`;

interface SessionViewerProps {
  session: Session;
  liveChangedIds: Set<string>;
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  openScratchTabs: string[];
  scratchFileMap: Record<string, { title: string }>;
  onCloseScratchTab: (fileId: string) => void;
  onNewScratchFile?: () => void;
  focusStepIndex?: number;
  searchHighlightQuery?: string | null;
}

const MAIN_TABS: { tab: "session" | "diff" | "plan"; label: string; icon: ReactNode }[] = [
  {
    tab: "session",
    label: "Session",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.75 6.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5H6.5v3.5a.75.75 0 0 1-1.5 0V6.5Z" />
      </svg>
    ),
  },
  {
    tab: "diff",
    label: "Diff",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
      </svg>
    ),
  },
  {
    tab: "plan",
    label: "Plan",
    icon: (
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25h-8.5ZM6.5 5.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      </svg>
    ),
  },
];

export function SessionViewer({
  session,
  liveChangedIds,
  activeTab: activeTabProp,
  onTabChange,
  openScratchTabs,
  scratchFileMap,
  onCloseScratchTab,
  onNewScratchFile,
  focusStepIndex,
  searchHighlightQuery,
}: SessionViewerProps) {
  const [localTab, setLocalTab] = useState<Tab>("session");
  const activeTab = activeTabProp ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );
  const [createFileOpen, setCreateFileOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMessages(session.id);
      setMessages(data || []);
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [session.id]);

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

  const tabIcon = (tab: Tab): ReactNode => {
    if (tab === "session")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.75 6.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5H6.5v3.5a.75.75 0 0 1-1.5 0V6.5Z" />
        </svg>
      );
    if (tab === "diff")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.75 2A1.75 1.75 0 0 1 3.5.25h9A1.75 1.75 0 0 1 14.25 2v12A1.75 1.75 0 0 1 12.5 15.75h-9A1.75 1.75 0 0 1 1.75 14V2ZM3.5 1.75a.25.25 0 0 0-.25.25v12c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V2a.25.25 0 0 0-.25-.25h-9ZM5 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5H5.75A.75.75 0 0 1 5 8.75Z" />
        </svg>
      );
    if (tab === "plan")
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25h-8.5ZM6.5 5.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      );
    if (tab.startsWith("scratch:"))
      return (
        <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 9 3.25V1.5H3.75Z" />
        </svg>
      );
    return null;
  };

  const scratchTabLabel = (fileId: string): string => {
    const info = scratchFileMap[fileId];
    return info?.title || "Untitled";
  };

  const isScratchTab = (tab: Tab): tab is `scratch:${string}` => tab.startsWith("scratch:");
  const scratchFileIdFromTab = (tab: Tab): string | null =>
    isScratchTab(tab) ? tab.slice(8) : null;

  return (
    <div className="flex flex-col h-full">
      <SessionHeader session={session} hasPrivacy={hasPrivacy} />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gh-border shrink-0 overflow-x-auto">
        {MAIN_TABS.map(
          (meta) =>
            (meta.tab !== "diff" || !session.parentId) && (
              <button
                key={meta.tab}
                type="button"
                className={`sess-tab-pill shrink-0 ${activeTab === meta.tab ? "sess-tab-pill--active" : ""}`}
                onClick={() => setActiveTab(meta.tab)}
              >
                {meta.icon}
                {meta.label}
                {meta.tab === "session" && messageCount.total > 0 && (
                  <span className="text-[11px] opacity-70 tabular-nums">{messageCount.total}</span>
                )}
              </button>
            ),
        )}
        {openScratchTabs.map((fid) => {
          const tab: Tab = `scratch:${fid}`;
          return (
            <button
              key={fid}
              type="button"
              className={`sess-tab-pill shrink-0 ${activeTab === tab ? "sess-tab-pill--active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tabIcon(tab)}
              <span className="truncate max-w-28">{scratchTabLabel(fid)}</span>
              <span
                role="button"
                className="ml-1 text-gh-text-secondary hover:text-gh-text cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseScratchTab(fid);
                }}
              >
                <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </span>
            </button>
          );
        })}
        {!session.parentId && (
          <>
            <div className="w-px h-4 bg-gh-border mx-1 shrink-0" />
            <button
              type="button"
              onClick={() => setCreateFileOpen(true)}
              className="sess-tab-pill text-gh-text-secondary hover:text-gh-text shrink-0"
              title="New file"
            >
              <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "session" && (
        <ConversationView
          messages={messages}
          session={session}
          loading={loading}
          onOpenModal={(content, title) => setMarkdownModal({ content, title })}
          focusStepIndex={focusStepIndex}
          searchHighlightQuery={searchHighlightQuery ?? undefined}
        />
      )}
      {activeTab === "diff" && (
        <div className="flex-1 overflow-y-auto">
          <DiffView
            sessionId={session.id}
            sessionDirectory={session.directory}
            refreshKey={refreshKey}
            searchHighlightQuery={searchHighlightQuery}
          />
        </div>
      )}
      {activeTab === "plan" && (
        <div className="flex-1 overflow-y-auto">
          <PlanView sessionId={session.id} refreshKey={refreshKey} searchHighlightQuery={searchHighlightQuery} />
        </div>
      )}
      {isScratchTab(activeTab) &&
        (() => {
          const fid = scratchFileIdFromTab(activeTab)!;
          return (
            <ScratchEditor
              key={fid}
              sessionId={session.id}
              fileId={fid}
              onDelete={() => onCloseScratchTab(fid)}
            />
          );
        })()}

      {/* Markdown modal */}
      <Modal
        isOpen={markdownModal !== null}
        onClose={() => setMarkdownModal(null)}
        title={markdownModal?.title}
        size="xl"
      >
        {markdownModal && (
          <MarkdownContent content={markdownModal.content} className="markdown-body--wide" />
        )}
      </Modal>

      {/* Create file dialog */}
      <Modal
        isOpen={createFileOpen}
        onClose={() => setCreateFileOpen(false)}
        title="Create new file"
        size="md"
      >
        <div className="p-3 space-y-1">
          <button
            type="button"
            onClick={() => {
              setCreateFileOpen(false);
              onNewScratchFile?.();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gh-text hover:bg-gh-bg-hover transition-colors cursor-pointer text-left border border-transparent hover:border-accent-border"
          >
            <svg className="size-5 shrink-0 text-accent" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 2.75C2 1.784 2.784 1 3.75 1h5.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v6.25c0 .966-.784 1.75-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 12.25V2.75Zm8.5 3.5v-1.5a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h.5v-4.25c0-.966.784-1.75 1.75-1.75h3.5v-.25Zm.75 0h-3.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h4.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25Z" />
            </svg>
            <div className="flex flex-col">
              <span className="font-medium">Markdown</span>
              <span className="text-[11px] text-gh-text-secondary">.md — Rich text file</span>
            </div>
          </button>
        </div>
      </Modal>
    </div>
  );
}
