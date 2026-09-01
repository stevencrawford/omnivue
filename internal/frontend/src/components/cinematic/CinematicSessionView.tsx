import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, Message, BookmarkKind, Plan, FileEdit } from "../../hooks/types";
import { fetchMessages, fetchPlan, fetchEdits } from "../../hooks/apiClient";
import { isAbortError } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { SessionHeader } from "../SessionHeader";
import { reconcileMessages } from "../SessionViewer";
import { TimelineScrubber } from "./TimelineScrubber";
import { FileAccessTree } from "./FileAccessTree";
import { FileDetail } from "./FileDetail";
import { ConsolePane } from "./ConsolePane";
import { NotificationDrawer, type ActivityTab } from "./NotificationDrawer";
import { TerminalPanel } from "../TerminalPanel";
import { useTimeline } from "../../hooks/useTimeline";
import { deriveFileAccess, type FileAccess } from "../../utils/fileAccess";
import { mergeFileEdits, relativizePath, type MergedFileDiff } from "../../utils/diffTree";
import { Modal } from "../ui/Modal";
import { MarkdownContent } from "../ui/MarkdownContent";
import { LoadingState } from "../ui/LoadingState";
import { useCopy } from "../../hooks/useCopy";
import { Check, Copy, PanelRightOpen, Activity, MessageSquare, FileText } from "lucide-react";
import { MarkdownScreenshotButton } from "../MarkdownScreenshotButton";
import { useResizable } from "../../hooks/useResizable";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../../utils/storageKeys";

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
  const [edits, setEdits] = useState<FileEdit[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(
    () => getStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED) === "true",
  );
  const [consoleCollapsed, setConsoleCollapsed] = useState(
    () => getStorageItem(STORAGE_KEYS.CINEMATIC_CONSOLE_COLLAPSED) === "true",
  );
  const [activityTab, setActivityTab] = useState<ActivityTab>(() => {
    const v = getStorageItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_TAB);
    if (v === "activity" || v === "prompt" || v === "plan") return v;
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

  const loadEdits = useCallback(async () => {
    try {
      const data = await fetchEdits(session.id);
      setEdits(data || []);
    } catch {
      setEdits([]);
    }
  }, [session.id]);

  useEffect(() => {
    loadMessages();
    loadPlan();
    loadEdits();
  }, [loadMessages, loadPlan, loadEdits]);

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
      loadEdits();
    }, 300);
    return () => clearTimeout(handle);
  }, [
    liveChangedIds,
    session.id,
    loadMessages,
    loadPlan,
    loadEdits,
    messages.length,
    loading,
    ackSessionChange,
  ]);

  const hasPrivacy = useMemo(
    () => messages.some((m) => m.metadata?.privacy === "true"),
    [messages],
  );
  const isActive = session.status === "active";

  // Fallback for live sessions: the parent's liveChangedIds is deduped by
  // contents, so a continuously-active session can appear as "unchanged" to
  // React even though its DB row keeps moving. When the session row itself
  // advances (updatedAt / cost / tokens), force a message reload so the file
  // tree, console, and activity panels stay live even if the SSE dedup skips.
  const lastSessionTickRef = useRef<string>(session.updatedAt);
  useEffect(() => {
    // reset tick when switching sessions
    lastSessionTickRef.current = session.updatedAt;
  }, [session.id]);
  useEffect(() => {
    if (session.status !== "active") {
      lastSessionTickRef.current = session.updatedAt;
      return;
    }
    if (session.updatedAt === lastSessionTickRef.current) return;
    // session row moved but liveChangedIds may not have flipped yet
    lastSessionTickRef.current = session.updatedAt;
    if (messages.length === 0 && loading) return;
    if (liveChangedIds.has(session.id)) return; // already scheduled via SSE
    const handle = setTimeout(() => {
      loadMessages();
      loadPlan();
      loadEdits();
    }, 300);
    return () => clearTimeout(handle);
  }, [
    session.updatedAt,
    session.status,
    session.id,
    liveChangedIds,
    messages.length,
    loading,
    loadMessages,
    loadPlan,
    loadEdits,
  ]);

  // Polling fallback when a session is active: guarantees the cinematic
  // panels (tree, file detail, console, activity + timeline) keep moving even
  // if an SSE event is dropped or deduped. Backs off immediately once the
  // session goes idle.
  useEffect(() => {
    if (!isActive) return;
    const iv = setInterval(() => {
      loadMessages();
      loadPlan();
      loadEdits();
    }, 5000);
    return () => clearInterval(iv);
  }, [isActive, loadMessages, loadPlan, loadEdits]);

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

  const fileAccessAll = useMemo(() => {
    const accesses = deriveFileAccess(messages);
    return accesses.map((a) => ({
      ...a,
      filePath: relativizePath(a.filePath, session.directory),
    }));
  }, [messages, session.directory]);

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
    if (events.length === 0 || cursor >= maxIndex) return fileAccessAll;
    return fileAccessAll.filter((fa) => {
      const eIdx = eventIndexByToolId.get(fa.tool.id);
      if (eIdx === undefined) return true;
      return eIdx <= cursor;
    });
  }, [fileAccessAll, events.length, cursor, maxIndex, eventIndexByToolId]);

  const visibleEdits = useMemo(() => {
    if (edits.length === 0) return [];
    if (events.length === 0) return edits;
    if (cursor >= maxIndex) return edits;
    const visibility = new Map<number, boolean>();
    let eventIdx = 0;
    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      const isUser = msg.role === "user";
      const msgEvents = isUser ? 1 : msg.toolCalls?.length ? msg.toolCalls.length : 1;
      const msgEnd = eventIdx + msgEvents - 1;
      const visible = msgEnd <= cursor;
      visibility.set(mi, visible);
      eventIdx += msgEvents;
    }
    return edits.filter((e) => {
      const mi = e.messageIndex;
      if (mi === undefined || mi < 0) return true;
      return visibility.get(mi) ?? true;
    });
  }, [edits, messages, cursor, maxIndex, events.length]);

  const mergedDiffs = useMemo(() => {
    const grouped = new Map<string, FileEdit[]>();
    for (const edit of visibleEdits) {
      if (!edit.filePath) continue;
      const relPath = relativizePath(edit.filePath, session.directory);
      const list = grouped.get(relPath) || [];
      list.push({ ...edit, filePath: relPath });
      grouped.set(relPath, list);
    }
    const result: MergedFileDiff[] = [];
    for (const [filePath, fileEdits] of grouped) {
      result.push(mergeFileEdits(filePath, fileEdits));
    }
    result.sort((a, b) => a.path.localeCompare(b.path));
    return result;
  }, [visibleEdits, session.directory]);

  const selectedMergedDiff = useMemo(() => {
    if (!selectedPath) return null;
    const normSelected = selectedPath.replace(/^\/+/, "");
    const relSelected = relativizePath(normSelected, session.directory);
    const found =
      mergedDiffs.find((d) => d.path === relSelected || d.path === normSelected) ?? null;
    if (found) return found;
    const selectedAccessForLookup = visibleAccess.find(
      (a) => a.filePath.replace(/^\/+/, "") === normSelected,
    );
    if (selectedAccessForLookup) {
      const rel = relativizePath(selectedAccessForLookup.filePath, session.directory);
      return mergedDiffs.find((d) => d.path === rel) ?? null;
    }
    return null;
  }, [mergedDiffs, selectedPath, session.directory, visibleAccess]);

  // Tree should show both reads (from fileAccess) and edits (from merged diffs).
  // fileAccess may miss some edits due to alias handling, and a file that was
  // both read and edited should appear as an edit (edit/write takes priority
  // over read — the diff is more useful than the preview).
  const treeAccesses = useMemo(() => {
    const fileMap = new Map<string, FileAccess>();
    for (const acc of visibleAccess) {
      const rel = relativizePath(acc.filePath.replace(/^\/+/, ""), session.directory);
      const normalized = { ...acc, filePath: rel } as FileAccess;
      const existing = fileMap.get(rel);
      if (!existing) {
        fileMap.set(rel, normalized);
      } else if (existing.kind === "read" && normalized.kind !== "read") {
        fileMap.set(rel, normalized);
      }
    }
    for (const diff of mergedDiffs) {
      const rel = diff.path;
      const existing = fileMap.get(rel);
      const kind =
        diff.status === "added" ? "write" : diff.status === "deleted" ? "delete" : "edit";
      if (!existing) {
        const synthetic = {
          id: `edit:${rel}`,
          filePath: rel,
          kind: kind as FileAccess["kind"],
          tool: {
            id: `edit:${rel}`,
            name: kind,
            input: JSON.stringify({ filePath: rel }),
            output: "",
            status: "completed",
          } as unknown as FileAccess["tool"],
          messageId: diff.hunks[0]?.messageId ?? "",
          messageIndex: diff.hunks[0]?.messageIndex ?? -1,
          timestamp: "",
        } as FileAccess;
        fileMap.set(rel, synthetic);
      } else if (existing.kind === "read") {
        const synthetic = {
          id: `edit:${rel}`,
          filePath: rel,
          kind: kind as FileAccess["kind"],
          tool: {
            id: `edit:${rel}`,
            name: kind,
            input: JSON.stringify({ filePath: rel }),
            output: "",
            status: "completed",
          } as unknown as FileAccess["tool"],
          messageId: diff.hunks[0]?.messageId ?? existing.messageId,
          messageIndex: diff.hunks[0]?.messageIndex ?? existing.messageIndex,
          timestamp: existing.timestamp,
        } as FileAccess;
        fileMap.set(rel, synthetic);
      }
    }
    return Array.from(fileMap.values());
  }, [visibleAccess, mergedDiffs, session.directory]);

  const selectedAccess = useMemo(() => {
    if (!selectedPath) return null;
    const normSelected = selectedPath.replace(/^\/+/, "");
    const relSelected = relativizePath(normSelected, session.directory);
    const fromTree =
      treeAccesses.find(
        (a) => a.filePath.replace(/^\/+/, "") === normSelected || a.filePath === relSelected,
      ) ?? null;
    if (fromTree) return fromTree;
    return visibleAccess.find((a) => a.filePath.replace(/^\/+/, "") === normSelected) ?? null;
  }, [visibleAccess, treeAccesses, selectedPath, session.directory]);

  useEffect(() => {
    if (!selectedPath && treeAccesses.length > 0) {
      setSelectedPath(treeAccesses[0].filePath);
    }
  }, [treeAccesses, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    const normSelected = selectedPath.replace(/^\/+/, "");
    const relSelected = relativizePath(normSelected, session.directory);
    const inTree = treeAccesses.some(
      (a) => a.filePath.replace(/^\/+/, "") === normSelected || a.filePath === relSelected,
    );
    if (!inTree) {
      if (treeAccesses.length > 0) setSelectedPath(treeAccesses[0].filePath);
      else setSelectedPath("");
    }
  }, [treeAccesses, selectedPath, session.directory]);

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
      setStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED, String(next));
      return next;
    });
  }, []);

  const toggleConsole = useCallback(() => {
    setConsoleCollapsed((v) => {
      const next = !v;
      setStorageItem(STORAGE_KEYS.CINEMATIC_CONSOLE_COLLAPSED, String(next));
      return next;
    });
  }, []);

  const handleActivityTabChange = useCallback((tab: ActivityTab) => {
    setActivityTab(tab);
    setStorageItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_TAB, tab);
  }, []);

  const handleCollapsedActivitySelect = useCallback(
    (tab: ActivityTab) => {
      handleActivityTabChange(tab);
      if (drawerCollapsed) {
        setDrawerCollapsed(false);
        setStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED, "false");
      }
    },
    [drawerCollapsed, handleActivityTabChange],
  );

  const firstMessage = messages[0];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[role="tree"], [contenteditable="true"], .xterm')) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === " ") {
        if (target.tagName === "BUTTON") return;
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
        {loading && messages.length === 0 ? (
          <LoadingState label="Loading session…" />
        ) : (
          <>
            <div className="flex flex-1 flex-col overflow-hidden min-w-0">
              <div className="flex flex-1 overflow-hidden min-h-0">
                <div
                  className="shrink-0 overflow-hidden flex flex-col border-r border-ov-border"
                  style={{ width: treeWidth }}
                >
                  <FileAccessTree
                    accesses={treeAccesses}
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
                  mergedDiff={selectedMergedDiff}
                  sessionDirectory={session.directory}
                  onJump={handleJumpToMessage}
                />
              </div>

              {!consoleCollapsed && (
                <div
                  className="h-1 shrink-0 bg-ov-border hover:bg-accent cursor-row-resize transition-colors relative"
                  onMouseDown={startConsoleResize}
                  title="Drag to resize console"
                >
                  <div className="absolute inset-x-0 -top-1 -bottom-1" />
                </div>
              )}
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
              <aside
                className="flex flex-col items-center w-12 shrink-0 border-l border-ov-border bg-ov-bg-sidebar py-1.5"
                aria-label="Activity panel (collapsed)"
              >
                {(
                  [
                    ["prompt", MessageSquare, "Prompt"],
                    ["activity", Activity, "Activity"],
                    ["plan", FileText, "Plan"],
                  ] as const
                ).map(([tab, Icon, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => handleCollapsedActivitySelect(tab)}
                    className={`relative flex items-center justify-center w-full h-10 cursor-pointer transition-colors ${
                      activityTab === tab
                        ? "text-accent"
                        : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
                    }`}
                    title={label}
                    aria-label={label}
                  >
                    {activityTab === tab && (
                      <div className="absolute right-0 w-0.5 h-5 rounded-l-full bg-accent" />
                    )}
                    <Icon className="size-4" strokeWidth={1.5} />
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={toggleDrawer}
                  className="flex items-center justify-center w-full h-10 text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                  title="Expand activity panel"
                  aria-label="Expand activity panel"
                >
                  <PanelRightOpen className="size-4" strokeWidth={1.5} />
                </button>
              </aside>
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
          </>
        )}
      </div>

      {terminalOpen && !session.parentId && (
        <div className="h-[300px] shrink-0 border-t border-ov-border flex flex-col overflow-hidden">
          <TerminalPanel sessionId={session.id} />
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
