import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Session,
  Message,
  BookmarkKind,
  Plan,
  FileEdit,
  Position,
  ScratchFile,
  Tab,
} from "../../hooks/types";
import { useCinematicSearchJump } from "../../hooks/useCinematicSearchJump";
import {
  fetchMessages,
  fetchPlan,
  fetchEdits,
  fetchScratchFiles,
  fetchSessionFile,
  createScratchFile,
  renameScratchFile,
  deleteScratchFile,
} from "../../hooks/apiClient";
import { isAbortError } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { SessionHeader } from "../SessionHeader";
import { reconcileMessages } from "../../utils/reconcileMessages";
import { TimelineScrubber } from "./TimelineScrubber";
import { FileAccessTree } from "./FileAccessTree";
import { FileDetail } from "./FileDetail";
import { ConsolePane } from "./ConsolePane";
import { NotificationDrawer, type ActivityTab } from "./NotificationDrawer";
import { TerminalPanel } from "../TerminalPanel";
import { ScratchEditor } from "../ScratchEditor";
import { useTimeline } from "../../hooks/useTimeline";
import { deriveFileAccess, type FileAccess } from "../../utils/fileAccess";
import { mergeFileEdits, relativizePath, type MergedFileDiff } from "../../utils/diffTree";
import { Modal } from "../ui/Modal";
import { MarkdownContent } from "../ui/MarkdownContent";
import { LoadingState } from "../ui/LoadingState";
import { useCopy } from "../../hooks/useCopy";
import {
  Check,
  Copy,
  PanelRightOpen,
  Activity,
  MessageSquare,
  FileText,
  FilePlus,
} from "lucide-react";
import { MarkdownScreenshotButton } from "../MarkdownScreenshotButton";
import { useResizable } from "../../hooks/useResizable";
import { useElementWidth } from "../../hooks/useElementWidth";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../../utils/storageKeys";
import { isSpanContained, mergeSpanRange } from "../../utils/spanRange";
import {
  DRAWER_DEFAULT_WIDTH,
  TREE_DEFAULT_WIDTH,
  shouldAutoCollapseDrawer,
} from "../../utils/cinematicLayout";

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
  onPinMessage?: (content: string) => void;
  /** A freshly pinned scratch file id to focus (set by the pin-message flow). */
  pinnedScratchId?: string | null;
  onJumpTerminal?: () => void;
  /** Hit tab from the navigation store (search hits set session/plan/scratch:*). */
  activeTab?: Tab;
  /** Jump target from the navigation store (search hits, diff nav, bookmarks). */
  focusPosition?: Position;
  focusMessageIndex?: number;
  focusMessageId?: string;
  focusMessageKey?: number;
  onClearFocus?: () => void;
}

export function CinematicSessionView({
  session,
  liveChangedIds,
  ackSessionChange,
  onNameChanged,
  onBookmark,
  bookmarkIdByRef,
  onPinMessage,
  pinnedScratchId,
  onJumpTerminal,
  activeTab,
  focusPosition,
  focusMessageIndex,
  focusMessageId,
  focusMessageKey = 0,
  onClearFocus,
}: CinematicSessionViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [edits, setEdits] = useState<FileEdit[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedScratchId, setSelectedScratchId] = useState<string | null>(null);
  const [scratchFiles, setScratchFiles] = useState<ScratchFile[]>([]);
  const [createScratchOpen, setCreateScratchOpen] = useState(false);
  const [deleteScratchId, setDeleteScratchId] = useState<string | null>(null);
  const [markdownModal, setMarkdownModal] = useState<{ content: string; title?: string } | null>(
    null,
  );
  const [terminalOpen, setTerminalOpen] = useState(false);
  // The user's resting preference for the activity drawer, persisted across
  // reloads and never touched by the width-driven auto-collapse.
  const [drawerCollapsedPref, setDrawerCollapsedPref] = useState(
    () => getStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED) === "true",
  );
  // Transient width-driven collapse. Deliberately not persisted: it is
  // recomputed from the row width, so widening the window — or collapsing the
  // LHS session list — restores whatever the user had chosen.
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  // Set when the user (or a jump) explicitly expands the drawer on a narrow
  // row, so the width-driven collapse does not immediately override them.
  const [autoCollapseOverride, setAutoCollapseOverride] = useState(false);
  const drawerCollapsed = drawerCollapsedPref || (autoCollapsed && !autoCollapseOverride);
  const [consoleCollapsed, setConsoleCollapsed] = useState(
    () => getStorageItem(STORAGE_KEYS.CINEMATIC_CONSOLE_COLLAPSED) === "true",
  );
  const [activityTab, setActivityTab] = useState<ActivityTab>(() => {
    const v = getStorageItem(STORAGE_KEYS.CINEMATIC_ACTIVITY_TAB);
    if (v === "activity" || v === "prompt" || v === "plan") return v;
    return "activity";
  });
  const [selectedSpan, setSelectedSpan] = useState<{
    start: number;
    end: number;
    trailing: boolean;
  } | null>(null);
  // Anchor turn for Shift+Click range extension. Stays fixed at the plain-clicked
  // turn so repeated Shift+Clicks recompute from the same origin; a Shift+Click
  // inside the current range is a no-op (never shrinks).
  const anchorSpanRef = useRef<{ start: number; end: number } | null>(null);
  const { showErrorToast } = useToast();

  // Search/message jump target. The timeline cursor is never moved by a jump:
  // the drawer spotlight-includes the target message and scrolls to it.
  const { spotlightId } = useCinematicSearchJump({
    messages,
    loading,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    focusMessageKey,
    onClearFocus,
  });

  const expandDrawer = useCallback(() => {
    setDrawerCollapsedPref(false);
    setAutoCollapseOverride(true);
    setStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED, "false");
  }, []);

  const { value: treeWidth, startResize: startTreeResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_TREE_WIDTH,
    axis: "horizontal",
    min: 180,
    max: 700,
    defaultValue: TREE_DEFAULT_WIDTH,
  });
  const { value: drawerWidth, startResize: startDrawerResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_DRAWER_WIDTH,
    axis: "horizontal",
    min: 260,
    max: 900,
    defaultValue: DRAWER_DEFAULT_WIDTH,
    invert: true,
  });
  const { value: consoleHeight, startResize: startConsoleResize } = useResizable({
    storageKey: STORAGE_KEYS.CINEMATIC_CONSOLE_HEIGHT,
    axis: "vertical",
    min: 140,
    max: 650,
    defaultValue: 260,
  });

  // The session row (tree | diff | drawer) is measured to decide when the
  // activity drawer must auto-collapse. It deliberately excludes the LHS
  // session sidebar, so collapsing that sidebar widens the row and restores the
  // drawer on its own — no cross-component wiring needed.
  const [rowRef, rowWidth] = useElementWidth<HTMLDivElement>();
  const wasNarrowRef = useRef(false);
  useEffect(() => {
    if (rowWidth === null) return;
    const narrow = shouldAutoCollapseDrawer(rowWidth);
    const wasNarrow = wasNarrowRef.current;
    wasNarrowRef.current = narrow;
    if (narrow) {
      setAutoCollapsed(true);
      // A fresh narrow episode clears any earlier manual override so the
      // drawer collapses again on the next squeeze.
      if (!wasNarrow) setAutoCollapseOverride(false);
    } else {
      setAutoCollapsed(false);
      setAutoCollapseOverride(false);
    }
  }, [rowWidth]);

  const loadRef = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  });

  const loadMessages = useCallback(
    async (background = false) => {
      const id = loadRef.current.id + 1;
      loadRef.current.controller?.abort();
      const controller = new AbortController();
      loadRef.current = { id, controller };
      if (!background) setLoading(true);
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
        if (!background && loadRef.current.id === id) setLoading(false);
      }
    },
    [session.id, showErrorToast],
  );

  const loadPlan = useCallback(
    async (background = false) => {
      if (!background) setPlanLoading(true);
      try {
        const data = await fetchPlan(session.id);
        // Avoid re-rendering the Plan tab when the polled content is
        // identical — a new object identity alone would flash the view.
        setPlan((prev) => {
          if (prev?.markdown === data?.markdown && prev?.source === data?.source) return prev;
          return data;
        });
      } catch {
        if (!background) setPlan(null);
      } finally {
        if (!background) setPlanLoading(false);
      }
    },
    [session.id],
  );

  const loadEdits = useCallback(async () => {
    try {
      const data = await fetchEdits(session.id);
      setEdits(data || []);
    } catch {
      setEdits([]);
    }
  }, [session.id]);

  const loadScratchFiles = useCallback(async () => {
    try {
      const data = await fetchScratchFiles(session.id);
      setScratchFiles(data || []);
    } catch {
      setScratchFiles([]);
    }
  }, [session.id]);

  useEffect(() => {
    loadMessages();
    loadPlan();
    loadEdits();
    loadScratchFiles();
  }, [loadMessages, loadPlan, loadEdits, loadScratchFiles]);

  useEffect(() => {
    setSelectedScratchId(null);
    setSelectedPath("");
  }, [session.id]);

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
      loadMessages(true);
      loadPlan(true);
      loadEdits();
      loadScratchFiles();
    }, 300);
    return () => clearTimeout(handle);
  }, [
    liveChangedIds,
    session.id,
    loadMessages,
    loadPlan,
    loadEdits,
    loadScratchFiles,
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
      loadMessages(true);
      loadPlan(true);
      loadEdits();
      loadScratchFiles();
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
    loadScratchFiles,
  ]);

  // Polling fallback when a session is active: guarantees the cinematic
  // panels (tree, file detail, console, activity + timeline) keep moving even
  // if an SSE event is dropped or deduped. Backs off immediately once the
  // session goes idle.
  useEffect(() => {
    if (!isActive) return;
    const iv = setInterval(() => {
      loadMessages(true);
      loadPlan(true);
      loadEdits();
      loadScratchFiles();
    }, 5000);
    return () => clearInterval(iv);
  }, [isActive, loadMessages, loadPlan, loadEdits, loadScratchFiles]);

  const {
    cursor,
    maxIndex,
    events,
    playing,
    setPlaying,
    speed,
    setSpeed,
    setCursor: setCursorRaw,
    endScrub,
    atLive,
    behind,
    goLive: goLiveRaw,
    step: stepRaw,
  } = useTimeline({
    messages,
    isActive,
    paused: !!selectedSpan && !selectedSpan.trailing,
  });

  // selectedSpan isolates the view to one turn — or a contiguous range of
  // turns via Shift+Click — between user prompts. Any scrub/play/live
  // navigation should clear the isolation so the prefix-time filter (cursor)
  // resumes. User navigation also releases any active jump focus: the
  // spotlight exists only to keep a jumped-to message visible past the cursor
  // filter, so moving the timeline (or isolating a turn) hands visibility back
  // to the normal cursor/span window.
  const releaseJumpFocus = useCallback(() => {
    if (focusMessageKey !== 0) onClearFocus?.();
  }, [focusMessageKey, onClearFocus]);

  const setCursor = useCallback(
    (next: number) => {
      anchorSpanRef.current = null;
      setSelectedSpan(null);
      releaseJumpFocus();
      setCursorRaw(next);
    },
    [setCursorRaw, releaseJumpFocus],
  );

  const goLive = useCallback(() => {
    anchorSpanRef.current = null;
    setSelectedSpan(null);
    releaseJumpFocus();
    goLiveRaw();
  }, [goLiveRaw, releaseJumpFocus]);

  const step = useCallback(
    (delta: number) => {
      anchorSpanRef.current = null;
      setSelectedSpan(null);
      releaseJumpFocus();
      stepRaw(delta);
    },
    [stepRaw, releaseJumpFocus],
  );

  const handleSpanSelect = useCallback(
    (start: number, end: number, extend: boolean) => {
      releaseJumpFocus();
      const clicked = { start, end };
      if (!extend) {
        // Plain click: clicking any turn inside the current selection clears
        // everything; otherwise isolate the clicked turn and re-anchor there.
        setSelectedSpan((prevSelected) => {
          if (prevSelected && isSpanContained(prevSelected, clicked)) {
            anchorSpanRef.current = null;
            return null;
          }
          anchorSpanRef.current = clicked;
          return { start, end, trailing: end === events.length };
        });
        return;
      }
      // Shift+Click: extend a contiguous range from the anchor. No anchor yet
      // behaves like a plain click; clicking inside the range does nothing.
      const anchor = anchorSpanRef.current;
      if (!anchor) {
        anchorSpanRef.current = clicked;
        setSelectedSpan({ start, end, trailing: end === events.length });
        return;
      }
      setSelectedSpan((prevSelected) => {
        if (prevSelected && isSpanContained(prevSelected, clicked)) return prevSelected;
        const merged = mergeSpanRange(anchor, clicked);
        if (prevSelected && prevSelected.start === merged.start && prevSelected.end === merged.end)
          return prevSelected;
        return { ...merged, trailing: merged.end === events.length };
      });
    },
    [events.length, releaseJumpFocus],
  );

  const handleClearSpan = useCallback(() => {
    anchorSpanRef.current = null;
    setSelectedSpan(null);
    releaseJumpFocus();
  }, [releaseJumpFocus]);

  // keep span valid when the event list changes (e.g. live growth or session switch)
  useEffect(() => {
    if (!selectedSpan) return;
    if (events.length === 0 || selectedSpan.start > maxIndex || selectedSpan.end > events.length) {
      anchorSpanRef.current = null;
      setSelectedSpan(null);
      return;
    }
    const hasStart = events.some(
      (e) => e.index === selectedSpan.start && e.kind === "user-request",
    );
    if (!hasStart) {
      anchorSpanRef.current = null;
      setSelectedSpan(null);
      return;
    }
    if (selectedSpan.trailing) {
      if (selectedSpan.end !== events.length) {
        setSelectedSpan({ start: selectedSpan.start, end: events.length, trailing: true });
      }
      return;
    }
    const hasEnd = events.some((e) => e.index === selectedSpan.end && e.kind === "user-request");
    if (!hasEnd) {
      anchorSpanRef.current = null;
      setSelectedSpan(null);
    }
  }, [events, maxIndex, selectedSpan]);

  useEffect(() => {
    anchorSpanRef.current = null;
    setSelectedSpan(null);
  }, [session.id]);

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
      anchorSpanRef.current = null;
      setSelectedSpan(null);
      releaseJumpFocus();
      let idx = -1;
      if (messageId) {
        idx = events.findIndex((e) => e.messageId === messageId);
      }
      if (idx === -1 && messageIndex >= 0) {
        idx = events.findIndex((e) => e.messageIndex === messageIndex);
      }
      if (idx >= 0) setCursorRaw(idx);
      else if (messageIndex >= 0) {
        // fallback to tool id mapping via messageIndex if not found in events
        // find first tool with that messageIndex
        for (const [toolId, eventIdx] of eventIndexByToolId) {
          const acc = fileAccessAll.find(
            (fa) => fa.tool.id === toolId && fa.messageIndex === messageIndex,
          );
          if (acc) {
            setCursorRaw(eventIdx);
            break;
          }
        }
      }
    },
    [events, setCursorRaw, eventIndexByToolId, fileAccessAll, releaseJumpFocus],
  );

  const visibleAccess = useMemo(() => {
    if (selectedSpan) {
      return fileAccessAll.filter((fa) => {
        const eIdx = eventIndexByToolId.get(fa.tool.id);
        if (eIdx === undefined) return true;
        return eIdx >= selectedSpan.start && eIdx < selectedSpan.end;
      });
    }
    if (events.length === 0 || cursor >= maxIndex) return fileAccessAll;
    return fileAccessAll.filter((fa) => {
      const eIdx = eventIndexByToolId.get(fa.tool.id);
      if (eIdx === undefined) return true;
      return eIdx <= cursor;
    });
  }, [fileAccessAll, events.length, cursor, maxIndex, eventIndexByToolId, selectedSpan]);

  const visibleEdits = useMemo(() => {
    if (edits.length === 0) return [];
    if (events.length === 0) return edits;
    if (selectedSpan) {
      const visibility = new Map<number, boolean>();
      let eventIdx = 0;
      for (let mi = 0; mi < messages.length; mi++) {
        const msg = messages[mi];
        const isUser = msg.role === "user";
        const msgEvents = isUser ? 1 : msg.toolCalls?.length ? msg.toolCalls.length : 1;
        const msgStart = eventIdx;
        const msgEnd = eventIdx + msgEvents - 1;
        const visible = msgEnd >= selectedSpan.start && msgStart < selectedSpan.end;
        visibility.set(mi, visible);
        eventIdx += msgEvents;
      }
      return edits.filter((e) => {
        const mi = e.messageIndex;
        if (mi === undefined || mi < 0) return true;
        return visibility.get(mi) ?? true;
      });
    }
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
  }, [edits, messages, cursor, maxIndex, events.length, selectedSpan]);

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
    if (selectedScratchId) return null;
    if (!selectedPath) return null;
    const normSelected = selectedPath.replace(/^\/+/, "");
    const relSelected = relativizePath(normSelected, session.directory);
    const fromTree =
      treeAccesses.find(
        (a) => a.filePath.replace(/^\/+/, "") === normSelected || a.filePath === relSelected,
      ) ?? null;
    if (fromTree) return fromTree;
    return visibleAccess.find((a) => a.filePath.replace(/^\/+/, "") === normSelected) ?? null;
  }, [visibleAccess, treeAccesses, selectedPath, session.directory, selectedScratchId]);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setSelectedScratchId(null);
  }, []);

  const handleSelectScratch = useCallback((id: string) => {
    setSelectedScratchId(id);
  }, []);

  const handleCreateScratch = useCallback(async () => {
    try {
      const f = await createScratchFile(session.id, "Untitled", "# Untitled");
      setScratchFiles((prev) => [f, ...prev]);
      setSelectedScratchId(f.id);
      setSelectedPath("");
      setCreateScratchOpen(false);
    } catch (err) {
      showErrorToast(err, "Failed to create scratch file");
    }
  }, [session.id, showErrorToast]);

  const handleRenameScratch = useCallback(
    async (id: string, title: string) => {
      try {
        await renameScratchFile(session.id, id, title);
        setScratchFiles((prev) => prev.map((f) => (f.id === id ? { ...f, title } : f)));
      } catch (err) {
        showErrorToast(err, "Failed to rename scratch file");
      }
    },
    [session.id, showErrorToast],
  );

  const handleDeleteScratch = useCallback(
    async (id: string) => {
      try {
        await deleteScratchFile(session.id, id);
        setScratchFiles((prev) => prev.filter((f) => f.id !== id));
        if (selectedScratchId === id) setSelectedScratchId(null);
      } catch (err) {
        showErrorToast(err, "Failed to delete scratch file");
      } finally {
        setDeleteScratchId(null);
      }
    },
    [session.id, selectedScratchId, showErrorToast],
  );

  useEffect(() => {
    if (selectedScratchId) return;
    if (!selectedPath && treeAccesses.length > 0) {
      setSelectedPath(treeAccesses[0].filePath);
    }
  }, [treeAccesses, selectedPath, selectedScratchId]);

  useEffect(() => {
    if (selectedScratchId) return;
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
  }, [treeAccesses, selectedPath, session.directory, selectedScratchId]);

  useEffect(() => {
    if (selectedScratchId && !scratchFiles.some((f) => f.id === selectedScratchId)) {
      setSelectedScratchId(null);
    }
  }, [scratchFiles, selectedScratchId]);

  // Pinning a message creates a scratch file server-side and hands us its id.
  // Reload the file list first so the focus survives the "unknown scratch id"
  // guard above, then select the file.
  const lastPinnedScratchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pinnedScratchId || lastPinnedScratchRef.current === pinnedScratchId) return;
    lastPinnedScratchRef.current = pinnedScratchId;
    let cancelled = false;
    void (async () => {
      await loadScratchFiles();
      if (cancelled) return;
      setSelectedScratchId(pinnedScratchId);
      setSelectedPath("");
    })();
    return () => {
      cancelled = true;
    };
  }, [pinnedScratchId, loadScratchFiles]);

  const handleOpenModal = useCallback((content: string, title?: string) => {
    setMarkdownModal({ content, title });
  }, []);

  // Renders the currently-selected tree file's on-disk content in the expanded
  // markdown viewer. Works for read and edited markdown files alike because the
  // backend reads from the session's working directory rather than the session
  // transcript (which may be ranged or partial).
  const handleOpenMarkdown = useCallback(async () => {
    if (!selectedPath) return;
    try {
      const file = await fetchSessionFile(session.id, selectedPath);
      setMarkdownModal({
        content: file.content,
        title: file.path.split("/").pop() || file.path,
      });
    } catch (err) {
      showErrorToast(err, "Failed to load markdown file");
    }
  }, [session.id, selectedPath, showErrorToast]);

  const handleJumpTerminal = useCallback(() => {
    if (onJumpTerminal) onJumpTerminal();
    setTerminalOpen((v) => !v);
  }, [onJumpTerminal]);

  const toggleDrawer = useCallback(() => {
    if (drawerCollapsed) {
      expandDrawer();
    } else {
      setDrawerCollapsedPref(true);
      setStorageItem(STORAGE_KEYS.CINEMATIC_DRAWER_COLLAPSED, "true");
    }
  }, [drawerCollapsed, expandDrawer]);

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
      if (drawerCollapsed) expandDrawer();
    },
    [drawerCollapsed, handleActivityTabChange, expandDrawer],
  );

  // Target routing. Two independent triggers share this effect:
  // - `activeTab` is a persistent navigation intent: "plan" opens the plan tab
  //   (plan bookmarks, plan search hits, Cmd+2), `scratch:<id>` selects the
  //   scratch file. It must fire on the value itself, not on the focus key —
  //   plan bookmarks carry no message focus.
  // - a message jump (focus key advanced, `activeTab === "session"`) reveals
  //   the activity drawer so the spotlighted message is visible, and returning
  //   to the session tab from plan/scratch hands the drawer back to activity.
  // The timeline cursor is never moved by a jump.
  const prevNavTabRef = useRef<Tab | undefined>(undefined);
  useEffect(() => {
    const prev = prevNavTabRef.current;
    prevNavTabRef.current = activeTab;
    if (activeTab === "plan") {
      handleActivityTabChange("plan");
      expandDrawer();
      return;
    }
    if (activeTab?.startsWith("scratch:")) {
      setSelectedScratchId(activeTab.slice(8));
      setSelectedPath("");
      return;
    }
    const returnedToSession = prev !== undefined && prev !== "session";
    if (focusMessageKey !== 0 || returnedToSession) {
      handleActivityTabChange("activity");
      expandDrawer();
    }
  }, [focusMessageKey, activeTab, handleActivityTabChange, expandDrawer]);

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
        if (selectedSpan) {
          anchorSpanRef.current = null;
          setSelectedSpan(null);
        }
        releaseJumpFocus();
        setPlaying((p) => !p);
      } else if (e.key === "Escape" && selectedSpan) {
        e.preventDefault();
        anchorSpanRef.current = null;
        setSelectedSpan(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, setPlaying, selectedSpan, releaseJumpFocus]);

  return (
    <div className="flex flex-col h-full">
      <SessionHeader
        session={session}
        hasPrivacy={hasPrivacy}
        onNameChanged={onNameChanged}
        onJumpTerminal={!session.parentId ? handleJumpTerminal : undefined}
        terminalActive={terminalOpen}
      />

      {terminalOpen && !session.parentId ? (
        <div className="flex-1 min-h-0 relative overflow-hidden border-t border-ov-border">
          <TerminalPanel sessionId={session.id} />
        </div>
      ) : (
        <>
          <TimelineScrubber
            events={events}
            cursor={cursor}
            maxIndex={maxIndex}
            playing={playing}
            speed={speed}
            onSpeedChange={setSpeed}
            onCursorChange={setCursor}
            onEndScrub={endScrub}
            onTogglePlay={() => {
              if (selectedSpan) {
                anchorSpanRef.current = null;
                setSelectedSpan(null);
              }
              releaseJumpFocus();
              setPlaying((p) => !p);
            }}
            onStep={step}
            onGoLive={goLive}
            atLive={atLive}
            behind={behind}
            isActive={isActive}
            selectedSpan={selectedSpan}
            onSpanSelect={handleSpanSelect}
            onClearSpan={handleClearSpan}
          />

          <div ref={rowRef} className="flex flex-1 overflow-hidden min-h-0">
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
                        onSelect={handleSelectFile}
                        scratchFiles={scratchFiles}
                        selectedScratchId={selectedScratchId}
                        onSelectScratch={handleSelectScratch}
                        onNewScratch={
                          !session.parentId ? () => setCreateScratchOpen(true) : undefined
                        }
                        onRenameScratch={handleRenameScratch}
                        onDeleteScratch={(id) => setDeleteScratchId(id)}
                      />
                    </div>
                    <div
                      className="w-1 shrink-0 bg-ov-border hover:bg-accent cursor-col-resize transition-colors relative"
                      onMouseDown={startTreeResize}
                    >
                      <div className="absolute inset-y-0 -left-1 -right-1" />
                    </div>
                    {selectedScratchId ? (
                      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                        <ScratchEditor
                          key={selectedScratchId}
                          sessionId={session.id}
                          fileId={selectedScratchId}
                        />
                      </div>
                    ) : (
                      <FileDetail
                        access={selectedAccess}
                        fileName={selectedPath.split("/").pop() || selectedPath}
                        mergedDiff={selectedMergedDiff}
                        sessionDirectory={session.directory}
                        onJump={handleJumpToMessage}
                        onOpenMarkdown={handleOpenMarkdown}
                      />
                    )}
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
                      selectedSpan={selectedSpan}
                      collapsed={consoleCollapsed}
                      onToggleCollapse={toggleConsole}
                    />
                  </div>
                </div>

                {drawerCollapsed ? (
                  <aside
                    className="flex flex-col items-center w-12 shrink-0 border-l border-ov-border bg-ov-bg-sidebar py-1.5 cursor-pointer"
                    aria-label="Activity panel (collapsed)"
                    role="button"
                    title="Expand activity panel"
                    onClick={toggleDrawer}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCollapsedActivitySelect(tab);
                        }}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDrawer();
                      }}
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
                        selectedSpan={selectedSpan}
                        session={session}
                        onOpenModal={handleOpenModal}
                        plan={plan}
                        planLoading={planLoading}
                        onToggleCollapse={toggleDrawer}
                        activeTab={activityTab}
                        onTabChange={handleActivityTabChange}
                        firstMessage={firstMessage}
                        spotlightId={spotlightId}
                        jumpKey={focusMessageKey}
                        onBookmark={onBookmark}
                        bookmarkIdByRef={bookmarkIdByRef}
                        onPin={onPinMessage}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
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

      <Modal
        isOpen={createScratchOpen}
        onClose={() => setCreateScratchOpen(false)}
        title="Create new scratch file"
        size="md"
      >
        <div className="p-3 space-y-1">
          <button
            type="button"
            onClick={handleCreateScratch}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-ov-text hover:bg-ov-bg-hover transition-colors cursor-pointer text-left border border-transparent hover:border-accent-border"
          >
            <FilePlus size={20} className="shrink-0 text-accent" />
            <div className="flex flex-col">
              <span className="font-medium">Scratch file</span>
              <span className="text-[11px] text-ov-text-secondary">
                Markdown (.md) — Rich text editor
              </span>
            </div>
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={deleteScratchId !== null}
        onClose={() => setDeleteScratchId(null)}
        title="Delete scratch file"
        size="md"
      >
        <div className="p-3 space-y-3">
          <p className="text-sm text-ov-text-secondary">
            Are you sure you want to delete this scratch file? This action cannot be undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteScratchId(null)}
              className="px-3 py-1.5 text-xs rounded-md text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (deleteScratchId) handleDeleteScratch(deleteScratchId);
              }}
              className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-500 cursor-pointer transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
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
