import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CirclePlus,
  FileText,
  ListTodo,
  File,
  X,
  Plus,
  FilePlus,
  Check,
  Copy,
  Pin,
} from "lucide-react";
import type { Session, Message } from "../hooks/useApi";
import { fetchMessages } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";
import { Modal } from "./Modal";
import { useCopy } from "../hooks/useCopy";
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
  onPinMessage?: (content: string) => void;
  focusStepIndex?: number;
  searchHighlightQuery?: string | null;
}

const MAIN_TABS: { tab: "session" | "diff" | "plan"; label: string; icon: ReactNode }[] = [
  { tab: "session", label: "Session", icon: <CirclePlus size={14} /> },
  { tab: "diff", label: "Diff", icon: <FileText size={14} /> },
  { tab: "plan", label: "Plan", icon: <ListTodo size={14} /> },
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
  onPinMessage,
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
    if (tab === "session") return <CirclePlus size={14} />;
    if (tab === "diff") return <FileText size={14} />;
    if (tab === "plan") return <ListTodo size={14} />;
    if (tab.startsWith("scratch:")) return <File size={14} />;
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
                <X size={12} />
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
              <Plus size={14} />
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
          onPin={onPinMessage}
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
          <PlanView
            sessionId={session.id}
            refreshKey={refreshKey}
            searchHighlightQuery={searchHighlightQuery}
          />
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
          <ModalMarkdownWrapper content={markdownModal.content} onPin={onPinMessage} />
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
            <FilePlus size={20} className="shrink-0 text-accent" />
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

function ModalMarkdownWrapper({
  content,
  onPin,
}: {
  content: string;
  onPin?: (content: string) => void;
}) {
  const { copied, copy } = useCopy(2000);
  return (
    <div className="relative group">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {onPin && (
          <button
            type="button"
            onClick={() => onPin(content)}
            className="size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated"
            title="Pin as scratch note"
          >
            <Pin size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={() => copy(content)}
          className="size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
      </div>
      <MarkdownContent content={content} className="markdown-body--wide" />
    </div>
  );
}
