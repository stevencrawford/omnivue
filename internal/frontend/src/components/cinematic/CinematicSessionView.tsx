import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, Message, BookmarkKind, Plan } from "../../hooks/types";
import { fetchMessages, fetchPlan } from "../../hooks/apiClient";
import { isAbortError } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { SessionHeader } from "../SessionHeader";
import { TimelineScrubber } from "./TimelineScrubber";
import { FileAccessTree } from "./FileAccessTree";
import { FileDetail } from "./FileDetail";
import { ConsolePane } from "./ConsolePane";
import { NotificationDrawer } from "./NotificationDrawer";
import { useTimeline } from "../../hooks/useTimeline";
import { deriveFileAccess } from "../../utils/fileAccess";
import { Modal } from "../ui/Modal";
import { MarkdownContent } from "../ui/MarkdownContent";
import { useCopy } from "../../hooks/useCopy";
import { Check, Copy, PanelRightOpen, Activity, MessageSquare, FileText } from "lucide-react";
import { MarkdownScreenshotButton } from "../MarkdownScreenshotButton";
import { useResizable } from "../../hooks/useResizable";
import { STORAGE_KEYS } from "../../utils/storageKeys";

function reconcileMessages(prev: Message[], next: Message[]): Message[] {
  if (prev.length === 0 || next.length === 0 || prev.length !== next.length) return next;
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
  )
    return false;
  if (JSON.stringify(a.metadata ?? null) !== JSON.stringify(b.metadata ?? null)) return false;
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
    )
      return false;
  }
  return true;
}

interface CinematicSessionViewProps {
  session: Session;
  liveChangedIds: Set<string>;
  ackSessionChange?: (id: string) => void;
  onNameChanged?: () => void;
  onBookmark?: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
    kind?: BookmarkKind,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
  onQueueChanged?: () => void;
  highlightPromptId?: string | null;
  onHighlightDone?: () => void;
  onJumpTerminal?: () => void;
}

export function CinematicSessionView({
  session,
  liveChangedIds,
  ackSessionChange,
  onNameChanged,
  onBookmark: _onBookmark,
  bookmarkIdByRef: _bookmarkIdByRef,
  onQueueChanged,
  highlightPromptId,
  onHighlightDone,
  onJumpTerminal,
}: CinematicSessionViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(() => {
    try {
      return localStorage.getItem("omnivue-cinematic-drawer-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [consoleCollapsed, setConsoleCollapsed] = useState(() => {
    try {
      return localStorage.getItem("omnivue-cinematic-console-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [activityTab, setActivityTab] = useState<"activity" | "prompt" | "plan">(() => {
    try {
      const v = localStorage.getItem("omnivue-cinematic-activity-tab");
      if (v === "activity" || v === "prompt" || v === "plan")
        return v as "activity" | "prompt" | "plan";
    } catch {
      /* ignore */
    }
    return "activity";
  });
  const { showErrorToast } = useToast();

  const { value: treeWidth, startResize: startTreeResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_TREE_WIDTH,
    axis: "horizontal",
    min: 180,
    max: 560,
    defaultValue: 280,
  });
  const { value: drawerWidth, startResize: startDrawerResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_DRAWER_WIDTH,
    axis: "horizontal",
    min: 260,
    max: 720,
    defaultValue: 360,
    invert: true,
  });
  const { value: consoleHeight, startResize: startConsoleResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_CONSOLE_HEIGHT,
    axis: "vertical",
    min: 140,
    max: 520,
    defaultValue: 260,
  });

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

  const loadPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const data = await fetchPlan(session.id);
      setPlan(data);
    } catch {
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    loadMessages();
    loadPlan();
  }, [loadMessages, loadPlan]);

  useEffect(() => {
    return () => {
      loadRef.current.controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!liveChangedIds.has(session.id)) return;
    if (messages.length === 0 && loading) return;
    const handle = setTimeout(() => {
      ackSessionChange?.(session.id);
      loadMessages();
      loadPlan();
    }, 300);
    return () => clearTimeout(handle);
  }, [
    liveChangedIds,
    session.id,
    loadMessages,
    loadPlan,
    messages.length,
    loading,
    ackSessionChange,
  ]);

  const hasPrivacy = useMemo(
    () => messages.some((m) => m.metadata?.privacy === "true"),
    [messages],
  );
  const isActive = session.status === "active";

  const {
    cursor,
    maxIndex,
    events,
    playing,
    setPlaying,
    setCursor,
    endScrub,
    atLive,
    behind,
    goLive,
    step,
  } = useTimeline({
    messages,
    isActive,
  });

  const fileAccessAll = useMemo(() => deriveFileAccess(messages), [messages]);

  const eventIndexByToolId = useMemo(() => {
    const map = new Map<string, number>();
    let ei = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        ei++;
        continue;
      }
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0) {
        for (const t of tools) {
          map.set(t.id, ei);
          ei++;
        }
      } else {
        ei++;
      }
    }
    return map;
  }, [messages]);

  const handleJumpToMessage = useCallback(
    (messageIndex: number, messageId?: string) => {
      let idx = -1;
      if (messageId) {
        idx = events.findIndex((e) => e.messageId === messageId);
      }
      if (idx === -1 && messageIndex >= 0) {
        idx = events.findIndex((e) => e.messageIndex === messageIndex);
      }
      if (idx >= 0) setCursor(idx);
      else if (messageIndex >= 0) {
        // fallback to tool id mapping via messageIndex if not found in events
        // find first tool with that messageIndex
        for (const [toolId, eventIdx] of eventIndexByToolId) {
          const acc = fileAccessAll.find(
            (fa) => fa.tool.id === toolId && fa.messageIndex === messageIndex,
          );
          if (acc) {
            setCursor(eventIdx);
            break;
          }
        }
      }
    },
    [events, setCursor, eventIndexByToolId, fileAccessAll],
  );

  const visibleAccess = useMemo(() => {
    if (events.length === 0) return fileAccessAll;
    if (cursor >= maxIndex) return fileAccessAll;
    const eventByToolId = new Map<string, number>();
    let ei = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        ei++;
        continue;
      }
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0) {
        for (const t of tools) {
          eventByToolId.set(t.id, ei);
          ei++;
        }
      } else {
        ei++;
      }
    }
    return fileAccessAll.filter((fa) => {
      const eIdx = eventByToolId.get(fa.tool.id);
      if (eIdx === undefined) return true;
      return eIdx <= cursor;
    });
  }, [fileAccessAll, messages, events.length, cursor, maxIndex]);

  const selectedAccess = useMemo(() => {
    if (!selectedPath) return null;
    return (
      visibleAccess.find(
        (a) => a.filePath.replace(/^\/+/, "") === selectedPath.replace(/^\/+/, ""),
      ) ?? null
    );
  }, [visibleAccess, selectedPath]);

  const allForSelected = useMemo(() => {
    if (!selectedAccess) return [];
    return visibleAccess.filter((a) => a.filePath === selectedAccess.filePath);
  }, [visibleAccess, selectedAccess]);

  useEffect(() => {
    if (!selectedPath && visibleAccess.length > 0) {
      setSelectedPath(visibleAccess[0].filePath);
    }
  }, [visibleAccess, selectedPath]);

  useEffect(() => {
    if (
      selectedPath &&
      !visibleAccess.some(
        (a) => a.filePath.replace(/^\/+/, "") === selectedPath.replace(/^\/+/, ""),
      )
    ) {
      if (visibleAccess.length > 0) setSelectedPath(visibleAccess[0].filePath);
      else setSelectedPath("");
    }
  }, [visibleAccess, selectedPath]);

  const handleOpenModal = useCallback((content: string, title?: string) => {
    setMarkdownModal({ content, title });
  }, []);

  const handleJumpTerminal = useCallback(() => {
    if (onJumpTerminal) onJumpTerminal();
    setTerminalOpen((v) => !v);
  }, [onJumpTerminal]);

  const toggleDrawer = useCallback(() => {
    setDrawerCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("omnivue-cinematic-drawer-collapsed", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleConsole = useCallback(() => {
    setConsoleCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("omnivue-cinematic-console-collapsed", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleActivityTabChange = useCallback((tab: "activity" | "prompt" | "plan") => {
    setActivityTab(tab);
    try {
      localStorage.setItem("omnivue-cinematic-activity-tab", tab);
    } catch {
      /* ignore */
    }
  }, []);

  const handleCollapsedActivitySelect = useCallback(
    (tab: "activity" | "prompt" | "plan") => {
      handleActivityTabChange(tab);
      if (drawerCollapsed) {
        setDrawerCollapsed(false);
        try {
          localStorage.setItem("omnivue-cinematic-drawer-collapsed", "false");
        } catch {
          /* ignore */
        }
      }
    },
    [drawerCollapsed, handleActivityTabChange],
  );

  const firstMessage = messages[0];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === " ") {
        const active = document.activeElement;
        if (active && (active.tagName === "BUTTON" || active.tagName === "INPUT")) return;
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, setPlaying]);

  return (
    <div className="flex flex-col h-full">
      <SessionHeader
        session={session}
        hasPrivacy={hasPrivacy}
        onNameChanged={onNameChanged}
        onJumpTerminal={handleJumpTerminal}
        terminalActive={terminalOpen}
      />

      <TimelineScrubber
        events={events}
        cursor={cursor}
        maxIndex={maxIndex}
        playing={playing}
        onCursorChange={setCursor}
        onEndScrub={endScrub}
        onTogglePlay={() => setPlaying((p) => !p)}
        onStep={step}
        onGoLive={goLive}
        atLive={atLive}
        behind={behind}
        isActive={isActive}
      />

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <div className="flex flex-1 overflow-hidden min-h-0">
            <div
              className="shrink-0 overflow-hidden flex flex-col border-r border-ov-border"
              style={{ width: treeWidth }}
            >
              <FileAccessTree
                accesses={visibleAccess}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            </div>
            <div
              className="w-1 shrink-0 bg-ov-border hover:bg-accent cursor-col-resize transition-colors relative"
              onMouseDown={startTreeResize}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
            <FileDetail
              access={selectedAccess}
              fileName={selectedPath.split("/").pop() || selectedPath}
              allAccessForFile={allForSelected}
              onJump={handleJumpToMessage}
            />
          </div>

          <div
            className="h-1 shrink-0 bg-ov-border hover:bg-accent cursor-row-resize transition-colors relative group"
            onMouseDown={consoleCollapsed ? undefined : startConsoleResize}
            onClick={toggleConsole}
            onDoubleClick={toggleConsole}
            title={
              consoleCollapsed ? "Click to expand console" : "Drag to resize, click to collapse"
            }
          >
            <div className="absolute inset-x-0 -top-1 -bottom-1" />
          </div>
          <div
            className="shrink-0 overflow-hidden flex flex-col"
            style={{ height: consoleCollapsed ? 36 : consoleHeight }}
          >
            <ConsolePane
              session={session}
              messages={messages}
              cursor={cursor}
              maxIndex={maxIndex}
              collapsed={consoleCollapsed}
              onToggleCollapse={toggleConsole}
            />
          </div>
        </div>

        {drawerCollapsed ? (
          <div
            className="flex flex-col items-center w-12 shrink-0 border-l border-ov-border bg-ov-bg-sidebar py-1.5 cursor-pointer"
            onClick={toggleDrawer}
            role="button"
            title="Expand"
            aria-label="Expand activity panel"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCollapsedActivitySelect("prompt");
              }}
              className={`relative flex items-center justify-center w-full h-10 cursor-pointer transition-colors ${activityTab === "prompt" ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"}`}
              title="Prompt"
              aria-label="Prompt"
            >
              {activityTab === "prompt" && (
                <div className="absolute right-0 w-0.5 h-5 rounded-l-full bg-accent" />
              )}
              <MessageSquare className="size-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCollapsedActivitySelect("activity");
              }}
              className={`relative flex items-center justify-center w-full h-10 cursor-pointer transition-colors ${activityTab === "activity" ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"}`}
              title="Activity"
              aria-label="Activity"
            >
              {activityTab === "activity" && (
                <div className="absolute right-0 w-0.5 h-5 rounded-l-full bg-accent" />
              )}
              <Activity className="size-4" strokeWidth={1.5} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCollapsedActivitySelect("plan");
              }}
              className={`relative flex items-center justify-center w-full h-10 cursor-pointer transition-colors ${activityTab === "plan" ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"}`}
              title="Plan"
              aria-label="Plan"
            >
              {activityTab === "plan" && (
                <div className="absolute right-0 w-0.5 h-5 rounded-l-full bg-accent" />
              )}
              <FileText className="size-4" strokeWidth={1.5} />
            </button>
            <div className="flex-1" />
            <div className="flex items-center justify-center w-full h-10 text-ov-text-secondary">
              <PanelRightOpen className="size-4" strokeWidth={1.5} />
            </div>
          </div>
        ) : (
          <>
            <div
              className="w-1 shrink-0 bg-ov-border hover:bg-accent cursor-col-resize transition-colors relative"
              onMouseDown={startDrawerResize}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
            <div
              className="shrink-0 overflow-hidden flex flex-col border-l border-ov-border min-h-0"
              style={{ width: drawerWidth }}
            >
              <NotificationDrawer
                messages={messages}
                cursor={cursor}
                maxIndex={maxIndex}
                session={session}
                onOpenModal={handleOpenModal}
                plan={plan}
                planLoading={planLoading}
                onToggleCollapse={toggleDrawer}
                activeTab={activityTab}
                onTabChange={handleActivityTabChange}
                firstMessage={firstMessage}
                onQueueChanged={onQueueChanged}
                highlightPromptId={highlightPromptId}
                onHighlightDone={onHighlightDone}
              />
            </div>
          </>
        )}
      </div>

      {terminalOpen && (
        <div className="h-[300px] shrink-0 border-t border-ov-border bg-ov-bg flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-ov-border bg-surface-elevated">
            <span className="text-xs font-semibold text-ov-text">Terminal</span>
            <button
              type="button"
              onClick={() => setTerminalOpen(false)}
              className="text-xs text-ov-text-secondary hover:text-ov-text cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center text-xs text-ov-text-secondary">
            Terminal for {session.id} — use “Copy resume” from header to resume in external
            terminal.
          </div>
        </div>
      )}

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