import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Session,
  Message,
  BookmarkKind,
  Plan,
  FileEdit,
  ScratchFile,
} from "../../hooks/types";
import {
  fetchMessages,
  fetchPlan,
  fetchEdits,
  fetchScratchFiles,
  createScratchFile,
  renameScratchFile,
  deleteScratchFile,
} from "../../hooks/apiClient";
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
  const [selectedScratchId, setSelectedScratchId] = useState<string | null>(null);
  const [scratchFiles, setScratchFiles] = useState<ScratchFile[]>([]);
  const [createScratchOpen, setCreateScratchOpen] = useState(false);
  const [deleteScratchId, setDeleteScratchId] = useState<string | null>(null);
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
  const [selectedSpan, setSelectedSpan] = useState<{ start: number; end: number } | null>(null);
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
      loadPlan();
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
      loadPlan();
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
      loadPlan();
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
  });

  // selectedSpan isolates the view to a turn between two user prompts.
  // Any scrub/play/live navigation should clear the isolation so the
  // prefix-time filter (cursor) resumes.
  const setCursor = useCallback(
    (next: number) => {
      setSelectedSpan(null);
      setCursorRaw(next);
    },
    [setCursorRaw],
  );

  const goLive = useCallback(() => {
    setSelectedSpan(null);
    goLiveRaw();
  }, [goLiveRaw]);

  const step = useCallback(
    (delta: number) => {
      setSelectedSpan(null);
      stepRaw(delta);
    },
    [stepRaw],
  );

  const handleSpanSelect = useCallback((start: number, end: number) => {
    setSelectedSpan((prev) =>
      prev && prev.start === start && prev.end === end ? null : { start, end },
    );
  }, []);

  const handleClearSpan = useCallback(() => setSelectedSpan(null), []);

  // keep span valid when the event list changes (e.g. live growth or session switch)
  useEffect(() => {
    if (!selectedSpan) return;
    if (events.length === 0 || selectedSpan.start > maxIndex || selectedSpan.end > events.length) {
      setSelectedSpan(null);
      return;
    }
    const hasStart = events.some(
      (e) => e.index === selectedSpan.start && e.kind === "user-request",
    );
    const isTrailing = selectedSpan.end === events.length;
    const hasEnd =
      isTrailing || events.some((e) => e.index === selectedSpan.end && e.kind === "user-request");
    if (!hasStart || !hasEnd) setSelectedSpan(null);
  }, [events, maxIndex, selectedSpan]);

  useEffect(() => {
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
      setSelectedSpan(null);
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
    [events, setCursorRaw, eventIndexByToolId, fileAccessAll],
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

  const fileTokenTotals = useMemo(() => {
    const totals = new Map<string, { in: number; out: number }>();
    if (visibleAccess.length === 0 && mergedDiffs.length === 0) return totals;

    // Convert per-message cumulative tokens to incremental deltas when the backend
    // reports cumulative totals (e.g. Codex TotalTokenUsage). Detection: sum of
    // per-message tokens far exceeds the session total.
    const msgDeltas: Array<{ in: number; out: number }> = messages.map((m) => ({
      in: m.tokensInput ?? 0,
      out: m.tokensOutput ?? 0,
    }));
    const sumIn = msgDeltas.reduce((s, d) => s + d.in, 0);
    const sumOut = msgDeltas.reduce((s, d) => s + d.out, 0);
    const isCumulativeIn = sumIn > session.tokensInput * 1.5 && session.tokensInput > 0;
    const isCumulativeOut = sumOut > session.tokensOutput * 1.5 && session.tokensOutput > 0;
    if (isCumulativeIn || isCumulativeOut) {
      let prevIn = 0;
      let prevOut = 0;
      for (let i = 0; i < messages.length; i++) {
        const rawIn = messages[i].tokensInput ?? 0;
        const rawOut = messages[i].tokensOutput ?? 0;
        if (isCumulativeIn) {
          if (rawIn > 0) {
            const delta = rawIn >= prevIn ? rawIn - prevIn : rawIn;
            msgDeltas[i].in = delta;
            prevIn = rawIn;
          } else {
            msgDeltas[i].in = 0;
          }
        }
        if (isCumulativeOut) {
          if (rawOut > 0) {
            const delta = rawOut >= prevOut ? rawOut - prevOut : rawOut;
            msgDeltas[i].out = delta;
            prevOut = rawOut;
          } else {
            msgDeltas[i].out = 0;
          }
        }
      }
    }

    // Per-message denominator data for fair per-tool attribution. Backends
    // attribute the same step/message totals to every tool in the group, so
    // summing full totals per file double-counts. Splitting equally among
    // tools sharing the same usage (or among all tools in the message as
    // fallback) makes per-file totals sum to the session total.
    const msgToolCounts = new Map<number, number>();
    const msgUsageGroups = new Map<number, Map<string, number>>();
    for (let mi = 0; mi < messages.length; mi++) {
      const tcs = messages[mi].toolCalls ?? [];
      msgToolCounts.set(mi, tcs.length);
      const group = new Map<string, number>();
      for (const tc of tcs) {
        if (tc.usage?.tokens) {
          const ut = tc.usage.tokens;
          const key = `${tc.usage.source}:${ut.input ?? 0},${ut.output ?? 0},${ut.cacheRead ?? 0},${ut.cacheWrite ?? 0},${ut.reasoning ?? 0}`;
          group.set(key, (group.get(key) ?? 0) + 1);
        }
      }
      if (group.size > 0) msgUsageGroups.set(mi, group);
    }

    const getShareForAccess = (mi: number, toolId: string): { in: number; out: number } | null => {
      if (mi < 0 || mi >= messages.length) return null;
      const msg = messages[mi];
      // Prefer per-tool usage when available (already split-aware via group size), but
      // skip it when we detected cumulative message totals — usage is then also
      // cumulative and would re-introduce the inflation; the corrected msgDeltas
      // are the accurate per-turn split instead.
      const tc = (msg.toolCalls ?? []).find((t) => t.id === toolId);
      const usage = tc?.usage;
      if (usage?.tokens && !(isCumulativeIn || isCumulativeOut)) {
        const ut = usage.tokens;
        const key = `${usage.source}:${ut.input ?? 0},${ut.output ?? 0},${ut.cacheRead ?? 0},${ut.cacheWrite ?? 0},${ut.reasoning ?? 0}`;
        const groupCount = msgUsageGroups.get(mi)?.get(key) ?? 1;
        const denom = Math.max(1, groupCount);
        const inShare = (ut.input ?? 0) / denom;
        const outShare = (ut.output ?? 0) / denom;
        if (inShare === 0 && outShare === 0) return null;
        return { in: inShare, out: outShare };
      }
      // Fallback to per-message delta split equally among tools in the message
      const delta = msgDeltas[mi];
      if (!delta || (delta.in === 0 && delta.out === 0)) return null;
      const denom = Math.max(1, msgToolCounts.get(mi) ?? 1);
      return { in: delta.in / denom, out: delta.out / denom };
    };

    // Accumulate per-file shares from each visible file access (one per tool call)
    const fileShares = new Map<string, { in: number; out: number; fallbackOccurrences: number }>();
    for (const acc of visibleAccess) {
      const share = getShareForAccess(acc.messageIndex, acc.tool.id);
      if (share) {
        const cur = fileShares.get(acc.filePath) ?? { in: 0, out: 0, fallbackOccurrences: 0 };
        cur.in += share.in;
        cur.out += share.out;
        fileShares.set(acc.filePath, cur);
      } else {
        const cur = fileShares.get(acc.filePath) ?? { in: 0, out: 0, fallbackOccurrences: 0 };
        cur.fallbackOccurrences += 1;
        fileShares.set(acc.filePath, cur);
      }
    }

    // Synthetic diff files that have no FileAccess (e.g. edits not recognized as
    // fileAccess due to alias) still need attribution. Attribute each distinct
    // message that contributed a hunk as one synthetic occurrence split from that
    // message's delta (counted as an extra tool in the message).
    for (const diff of mergedDiffs) {
      if (fileShares.has(diff.path)) continue;
      const distinctMI = new Set<number>();
      for (const h of diff.hunks) {
        if (h.messageIndex != null && h.messageIndex >= 0) distinctMI.add(h.messageIndex);
      }
      if (distinctMI.size === 0) continue;
      let inSum = 0;
      let outSum = 0;
      let hasData = false;
      let fallbackCount = 0;
      for (const mi of distinctMI) {
        if (mi < 0 || mi >= messages.length) continue;
        const msg = messages[mi];
        // Check if this message's tools already have usage that would cover the synthetic edit
        // If so, treat synthetic as part of same group size +1.
        const delta = msgDeltas[mi];
        if (delta.in !== 0 || delta.out !== 0) {
          const denom = Math.max(1, (msgToolCounts.get(mi) ?? 0) + 1);
          inSum += delta.in / denom;
          outSum += delta.out / denom;
          hasData = true;
        } else {
          // No delta data -> will fall back to session distribution
          fallbackCount += 1;
        }
        // Also consider per-tool usage if the message's toolCalls include an edit for this file
        // but was not captured as FileAccess (e.g. view alias). Try to find a matching tool
        // by file path inside input.
        void msg;
      }
      if (hasData) {
        totals.set(diff.path, { in: Math.round(inSum), out: Math.round(outSum) });
      } else if (fallbackCount > 0) {
        fileShares.set(diff.path, { in: 0, out: 0, fallbackOccurrences: fallbackCount });
      }
    }

    // Populate totals from fileShares where we have real data
    for (const [path, share] of fileShares) {
      if (share.in !== 0 || share.out !== 0) {
        totals.set(path, { in: Math.round(share.in), out: Math.round(share.out) });
      }
    }

    const hasRealTokens = totals.size > 0;
    if (!hasRealTokens) {
      // Fallback: no per-message/per-tool token data at all (e.g. Cursor or OpenCode
      // before step attribution). Distribute visible session totals proportionally to
      // occurrence counts, scaled to the visible timeline window.
      const fallbackEntries = Array.from(fileShares.entries()).filter(
        ([, v]) => v.fallbackOccurrences > 0,
      );
      // Also include diff synthetic paths that already have a totals entry? No, those have data.
      // If still empty but we have visible accesses, fall back to counting accesses.
      const effectiveFallback =
        fallbackEntries.length > 0
          ? fallbackEntries
          : (() => {
              const counts = new Map<string, number>();
              for (const acc of visibleAccess)
                counts.set(acc.filePath, (counts.get(acc.filePath) ?? 0) + 1);
              for (const diff of mergedDiffs) {
                if (!counts.has(diff.path)) {
                  const distinct = new Set<number>();
                  for (const h of diff.hunks)
                    if (h.messageIndex != null && h.messageIndex >= 0) distinct.add(h.messageIndex);
                  if (distinct.size > 0) counts.set(diff.path, distinct.size);
                }
              }
              return Array.from(counts.entries()).map(
                ([p, c]) => [p, { in: 0, out: 0, fallbackOccurrences: c }] as const,
              );
            })();
      if (effectiveFallback.length > 0 && (session.tokensInput > 0 || session.tokensOutput > 0)) {
        const totalOccurrences = effectiveFallback.reduce(
          (s, [, v]) => s + v.fallbackOccurrences,
          0,
        );
        if (totalOccurrences > 0) {
          let visiblePct = 1;
          if (selectedSpan && events.length > 0) {
            visiblePct = (selectedSpan.end - selectedSpan.start) / events.length;
          } else if (cursor < maxIndex && maxIndex > 0) {
            visiblePct = (cursor + 1) / (maxIndex + 1);
          }
          const totalInVisible = Math.round(session.tokensInput * visiblePct);
          const totalOutVisible = Math.round(session.tokensOutput * visiblePct);
          for (const [path, share] of effectiveFallback) {
            if (totals.has(path)) continue;
            const occ = share.fallbackOccurrences;
            const inShare = Math.round(totalInVisible * (occ / totalOccurrences));
            const outShare = Math.round(totalOutVisible * (occ / totalOccurrences));
            if (inShare !== 0 || outShare !== 0) totals.set(path, { in: inShare, out: outShare });
          }
        }
      }
    }

    return totals;
  }, [
    visibleAccess,
    mergedDiffs,
    messages,
    session.tokensInput,
    session.tokensOutput,
    selectedSpan,
    cursor,
    maxIndex,
    events.length,
  ]);

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
        if (selectedSpan) setSelectedSpan(null);
        setPlaying((p) => !p);
      } else if (e.key === "Escape" && selectedSpan) {
        e.preventDefault();
        setSelectedSpan(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, setPlaying, selectedSpan]);

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
              if (selectedSpan) setSelectedSpan(null);
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
                        onSelect={handleSelectFile}
                        tokenTotals={fileTokenTotals}
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
