import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { useCopy } from "./hooks/useCopy";
import { Sidebar } from "./components/Sidebar";
import type { Section } from "./components/IconChannel";
import { SessionViewer } from "./components/SessionViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { SearchPanel } from "./components/SearchPanel";
import { SearchResultsDrawer } from "./components/SearchResultsDrawer";
import { Modal } from "./components/Modal";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Tab } from "./components/SessionViewer";
import { useSSE } from "./hooks/useSSE";
import { SessionNavContext, SearchHighlightContext } from "./hooks/useNav";
import { ThemeProvider } from "./hooks/useTheme";
import type { Session, SearchResult, Bookmark } from "./hooks/useApi";
import {
  fetchSessions,
  fetchSearch,
  createScratchFile,
  renameScratchFile,
  fetchBookmarks,
} from "./hooks/useApi";
import type { ScratchFile } from "./hooks/useApi";
import { fetchAllScratchFiles } from "./hooks/useApi";
import { createBookmark, deleteBookmark } from "./hooks/useApi";
import { useRecentSearches } from "./hooks/useRecentSearches";

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusStepIndex, setFocusStepIndex] = useState<number | undefined>(undefined);
  const [focusMessageIndex, setFocusMessageIndex] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("session");
  const [scratchFiles, setScratchFiles] = useState<ScratchFile[]>([]);
  const [openScratchTabs, setOpenScratchTabs] = useState<string[]>([]);
  const [liveChangedIds, setLiveChangedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSessionScope, setSearchSessionScope] = useState<string | null>(null);
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState("");
  const [drawerResults, setDrawerResults] = useState<SearchResult[]>([]);
  const [activeSection, setActiveSection] = useState<Section>("sessions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinningContent, setPinningContent] = useState<string | null>(null);
  const [pinTitle, setPinTitle] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const { recentSearches, addSearch, clearSearches } = useRecentSearches();

  const bookmarkIdByRef = useMemo(() => {
    const map: Record<string, string> = {};
    for (const bm of bookmarks) {
      const key = `${bm.sessionId}:${bm.messageIndex}:${bm.toolCallId || ""}`;
      map[key] = bm.id;
    }
    return map;
  }, [bookmarks]);
  const scrollPositions = useRef(new Map<string, number>());
  const SCROLL_POSITION_CAP = 100;

  const saveScrollPosition = useCallback((id: string, pos: number) => {
    const map = scrollPositions.current;
    if (map.size >= SCROLL_POSITION_CAP && !map.has(id)) {
      const firstKey = map.keys().next().value;
      if (firstKey !== undefined) map.delete(firstKey);
    }
    map.set(id, pos);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      setSessions(data || []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }, []);

  const loadScratchFiles = useCallback(async () => {
    try {
      const data = await fetchAllScratchFiles();
      setScratchFiles(data || []);
    } catch {
      setScratchFiles([]);
    }
  }, []);

  const loadBookmarks = useCallback(async () => {
    try {
      const data = await fetchBookmarks();
      setBookmarks(data || []);
    } catch {
      setBookmarks([]);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadScratchFiles();
    loadBookmarks();
  }, [loadSessions, loadScratchFiles, loadBookmarks]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "k")) {
        e.preventDefault();
        if (drawerOpen) {
          setDrawerOpen(false);
          setDrawerResults([]);
        }
        setSearchOpen((v) => {
          if (!v) {
            setSearchSessionScope(activeSessionId);
          }
          return !v;
        });
        return;
      }
      if (e.key === "Escape") {
        if (drawerOpen) {
          setDrawerOpen(false);
          setDrawerResults([]);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (searchHighlightQuery) {
          setSearchHighlightQuery(null);
          setFocusMessageIndex(undefined);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        return;
      }

      if (searchOpen || drawerOpen) return;

      if ((e.metaKey || e.ctrlKey) && !isInput) {
        const tabMap: Record<string, Tab> = {
          "1": "session",
          "2": "diff",
        };
        const tab = tabMap[e.key];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab);
          return;
        }
      }

      if (!isInput && !e.metaKey && !e.ctrlKey) {
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setSearchHighlightQuery(null);
          setActiveSessionId((prev) => {
            const idx = sessions.findIndex((s) => s.id === prev);
            if (idx < sessions.length - 1) return sessions[idx + 1].id;
            return prev;
          });
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSearchHighlightQuery(null);
          setActiveSessionId((prev) => {
            const idx = sessions.findIndex((s) => s.id === prev);
            if (idx > 0) return sessions[idx - 1].id;
            return prev;
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    searchOpen,
    sessions,
    drawerOpen,
    activeSessionId,
    searchHighlightQuery,
    setFocusMessageIndex,
  ]);

  useSSE({
    onUpdate: () => {
      loadSessions();
    },
    onSessionChanged: (ids) => {
      if (ids.length > 0) {
        setLiveChangedIds(new Set(ids));
      }
    },
  });

  // URL hash deep-linking
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (sessions.some((s) => s.id === id)) {
        setActiveSessionId(id);
        if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
      }
    } else if (activeSessionId === null && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId === null]);

  // Sync activeSessionId to URL hash
  useEffect(() => {
    if (activeSessionId) {
      const hash = `#/session/${encodeURIComponent(activeSessionId)}`;
      history.replaceState(null, "", hash);
    }
  }, [activeSessionId]);

  // Handle browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/session\/([^/]+)(?:\/step\/(\d+))?/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (sessions.some((s) => s.id === id)) {
          setActiveSessionId(id);
          if (match[2]) setFocusStepIndex(parseInt(match[2], 10));
          else setFocusStepIndex(undefined);
        }
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [sessions]);

  // Clear focusStepIndex when activeSessionId changes (except on initial hash parse)
  // focusMessageIndex is managed separately by handleSearchSelect
  const isInitialHashRef = useRef(true);
  useEffect(() => {
    if (isInitialHashRef.current) {
      isInitialHashRef.current = false;
      return;
    }
    setFocusStepIndex(undefined);
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  useEffect(() => {
    document.title = activeSession
      ? `Omnivue \u2014 ${activeSession.title}`
      : "Omnivue";
  }, [activeSession]);

  const sessionIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

  const validScratchFiles = useMemo(
    () => scratchFiles.filter((f) => sessionIds.has(f.sessionId)),
    [scratchFiles, sessionIds],
  );

  const scratchFileMap = useMemo(() => {
    const map: Record<string, { title: string; mode: string; sessionId: string }> = {};
    for (const f of validScratchFiles) {
      map[f.id] = { title: f.title, mode: f.mode, sessionId: f.sessionId };
    }
    return map;
  }, [validScratchFiles]);

  const handleBookmark = useCallback(
    async (
      sessionId: string,
      messageIndex: number,
      toolCallId: string | undefined,
      label: string,
    ) => {
      try {
        await createBookmark({ sessionId, messageIndex, toolCallId, label });
        await loadBookmarks();
      } catch {
        /* ignore */
      }
    },
    [loadBookmarks],
  );

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      try {
        await deleteBookmark(id);
        await loadBookmarks();
      } catch {
        /* ignore */
      }
    },
    [loadBookmarks],
  );

  const handleBookmarkSelect = useCallback(
    (sessionId: string, messageIndex: number, _toolCallId?: string) => {
      setActiveSessionId(sessionId);
      setFocusMessageIndex(messageIndex);
      setFocusStepIndex(undefined);
      setActiveTab("session");
      setSearchHighlightQuery(null);
    },
    [],
  );

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setFocusStepIndex(undefined);
    setFocusMessageIndex(undefined);
    setActiveTab("session");
    setSearchHighlightQuery(null);
  }, []);

  const prevSessionIdRef = useRef<string | null>(null);

  // Auto-open scratch tabs when a session is selected
  useEffect(() => {
    if (!activeSessionId) return;
    if (prevSessionIdRef.current === activeSessionId) return;
    prevSessionIdRef.current = activeSessionId;
    const sessionFileIds = validScratchFiles
      .filter((f) => f.sessionId === activeSessionId)
      .map((f) => f.id);
    setOpenScratchTabs(sessionFileIds);
  }, [activeSessionId, validScratchFiles]);

  const handleNewScratchFile = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const f = await createScratchFile(activeSessionId, "Untitled", "# Untitled");
      setScratchFiles((prev) => [f, ...prev]);
      setOpenScratchTabs((prev) => [...prev, f.id]);
      setActiveTab(`scratch:${f.id}`);
    } catch {
      /* ignore */
    }
  }, [activeSessionId]);

  const handlePinMessage = useCallback((content: string) => {
    const firstLine = (() => {
      for (const line of content.split("\n")) {
        const t = line.trim();
        const h1 = t.match(/^#\s+(.+)/);
        if (h1) return h1[1].trim();
      }
      for (const line of content.split("\n")) {
        const t = line.trim();
        if (t && !t.startsWith("```")) {
          const cleaned = t.replace(/^#+\s*/, "");
          return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
        }
      }
      return "Pinned message";
    })();
    setPinTitle(firstLine);
    setPinningContent(content);
  }, []);

  const handleConfirmPin = useCallback(async () => {
    if (!activeSessionId || !pinningContent) return;
    try {
      const title = pinTitle.trim() || "Pinned message";
      const f = await createScratchFile(activeSessionId, title, pinningContent, "readonly");
      setScratchFiles((prev) => [f, ...prev]);
      setOpenScratchTabs((prev) => (prev.includes(f.id) ? prev : [...prev, f.id]));
      setActiveTab(`scratch:${f.id}`);
    } catch {
      /* ignore */
    } finally {
      setPinningContent(null);
      setPinTitle("");
    }
  }, [activeSessionId, pinningContent, pinTitle]);

  const handleCancelPin = useCallback(() => {
    setPinningContent(null);
    setPinTitle("");
  }, []);

  const handleCloseScratchTab = useCallback(
    (fileId: string) => {
      setOpenScratchTabs((prev) => {
        const next = prev.filter((id) => id !== fileId);
        return next;
      });
      const tab: Tab = `scratch:${fileId}`;
      if (activeTab === tab && activeSession) {
        setActiveTab("session");
      }
    },
    [activeTab, activeSession],
  );

  const handleRenameScratchFile = useCallback(
    async (fileId: string, newTitle: string) => {
      const info = scratchFileMap[fileId];
      if (!info) return;
      try {
        await renameScratchFile(info.sessionId, fileId, newTitle);
        setScratchFiles((prev) =>
          prev.map((f) => (f.id === fileId ? { ...f, title: newTitle } : f)),
        );
      } catch {
        /* ignore */
      }
    },
    [scratchFileMap],
  );

  const handleSearchSelect = useCallback(
    (
      sessionId: string,
      chunkType: string,
      query: string,
      fileId?: string,
      messageIndex?: number,
    ) => {
      if (query.trim()) addSearch(query);
      setActiveSessionId(sessionId);
      const tabMap: Record<string, Tab> = {
        name: "session",
        message: "session",
        messages: "session",
        plan: "plan",
      };
      if (chunkType === "scratch" && fileId) {
        setActiveTab(`scratch:${fileId}`);
      } else {
        setActiveTab(tabMap[chunkType] || "session");
      }
      setSearchHighlightQuery(query || null);
      setFocusStepIndex(undefined);
      setFocusMessageIndex(messageIndex);
      setSearchOpen(false);
      setDrawerOpen(false);
    },
    [addSearch],
  );

  const handleSearchOpenDrawer = useCallback(
    async (q: string) => {
      if (q.trim()) addSearch(q);
      try {
        const data = await fetchSearch(q.trim(), 100, searchSessionScope ?? undefined);
        setDrawerQuery(q);
        setDrawerResults(data || []);
        setDrawerOpen(true);
        setSearchOpen(false);
      } catch {
        setDrawerResults([]);
      }
    },
    [searchSessionScope, addSearch],
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setDrawerResults([]);
  }, []);

  const handleDrawerClearScope = useCallback(() => {
    setSearchSessionScope(null);
    if (drawerQuery.trim()) {
      fetchSearch(drawerQuery.trim(), 100)
        .then((data) => {
          setDrawerResults(data || []);
        })
        .catch(() => {
          setDrawerResults([]);
        });
    }
  }, [drawerQuery]);

  const { copied: initCopied, copy: copyInit } = useCopy(1500);
  const isMac = typeof navigator !== "undefined" && navigator.platform?.includes("Mac");

  return (
    <ThemeProvider>
      <div className="flex flex-col h-full font-sans text-gh-text bg-gh-bg">
        <header className="sess-glass h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 border-b border-gh-header-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <svg
                className="size-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6,18 Q9,14 12,10" opacity="0.4" />
                <path d="M9,19 Q10.5,15 12,10" opacity="0.7" />
                <path d="M15,19 Q13.5,15 12,10" opacity="0.7" />
                <path d="M18,18 Q15,14 12,10" opacity="0.4" />
                <path d="M7,12 Q8.5,4 12,4 Q15.5,4 17,12 L16,12 Q12,8 8,12 Z" />
                <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
              </svg>
              <h1 className="text-sm font-semibold tracking-tight">Omnivue</h1>
            </div>
          </div>

          <button
            type="button"
            className={`sess-search-trigger ${searchHighlightQuery ? "sess-search-active" : ""}`}
            onClick={() => {
              if (searchHighlightQuery) setSearchQuery(searchHighlightQuery);
              setSearchOpen(true);
            }}
          >
            <svg className="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
            </svg>
            <span className="flex-1 text-left truncate">
              {searchHighlightQuery ? (
                <span className="text-accent font-medium">
                  Search: &ldquo;{searchHighlightQuery}&rdquo;
                </span>
              ) : (
                "Search sessions..."
              )}
            </span>
            {searchHighlightQuery && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchHighlightQuery(null);
                  setFocusMessageIndex(undefined);
                }}
                className="size-4 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer shrink-0"
              >
                <X size={12} />
              </span>
            )}
            <span className="sess-kbd">{isMac ? "⌘" : "Ctrl"}F</span>
          </button>

          <div className="flex items-center justify-end gap-2">
            <ThemeToggle />
          </div>
        </header>

        {searchOpen && (
          <SearchPanel
            query={searchQuery}
            onQueryChange={setSearchQuery}
            onSelectSession={handleSearchSelect}
            onOpenDrawer={handleSearchOpenDrawer}
            onClose={() => setSearchOpen(false)}
            searchScope={searchSessionScope}
            searchScopeName={(() => {
              if (!searchSessionScope) return null;
              const s = sessions.find((s) => s.id === searchSessionScope);
              return s?.title || s?.repository || null;
            })()}
            onClearScope={() => setSearchSessionScope(null)}
            recentSearches={recentSearches}
            onClearRecentSearches={clearSearches}
          />
        )}
        <SearchResultsDrawer
          isOpen={drawerOpen}
          query={drawerQuery}
          results={drawerResults}
          onSelect={handleSearchSelect}
          onClose={handleDrawerClose}
          searchScopeName={(() => {
            if (!searchSessionScope) return null;
            const s = sessions.find((s) => s.id === searchSessionScope);
            return s?.title || s?.repository || null;
          })()}
          onClearScope={handleDrawerClearScope}
        />

        <SessionNavContext.Provider
          value={{
            navigateToSession: handleSessionSelect,
            scrollPositions: scrollPositions.current,
            saveScrollPosition,
          }}
        >
          <div className="flex flex-1 overflow-hidden">
            <ErrorBoundary>
              <Sidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSessionSelect={handleSessionSelect}
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                onSettingsOpen={() => setSettingsOpen(true)}
                sidebarOpen={sidebarOpen}
                onSidebarToggle={() => setSidebarOpen((v) => !v)}
                bookmarks={bookmarks}
                onBookmarkSelect={handleBookmarkSelect}
                onBookmarkDelete={handleBookmarkDelete}
              />
            </ErrorBoundary>
            <main className="flex-1 flex flex-col overflow-hidden sess-main-canvas">
              {activeSession ? (
                <ErrorBoundary>
                  <SearchHighlightContext.Provider value={searchHighlightQuery ?? ""}>
                    <SessionViewer
                      key={activeSession.id}
                      session={activeSession}
                      liveChangedIds={liveChangedIds}
                      activeTab={activeTab}
                      onTabChange={setActiveTab}
                      openScratchTabs={openScratchTabs}
                      scratchFileMap={scratchFileMap}
                      onCloseScratchTab={handleCloseScratchTab}
                      onNewScratchFile={handleNewScratchFile}
                      onRenameScratchFile={handleRenameScratchFile}
                      onPinMessage={handlePinMessage}
                      onBookmark={handleBookmark}
                      bookmarkIdByRef={bookmarkIdByRef}
                      focusStepIndex={focusStepIndex}
                      focusMessageIndex={focusMessageIndex}
                      searchHighlightQuery={searchHighlightQuery}
                    />
                  </SearchHighlightContext.Provider>
                </ErrorBoundary>
              ) : (
                <div className="sess-empty-state flex-1 h-full">
                  {sessions.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 max-w-xs">
                      <svg
                        className="size-8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                      <p className="text-sm font-medium text-gh-text">No sessions yet</p>
                      <p className="text-xs text-gh-text-secondary text-center leading-relaxed">
                        Add agent directories so Omnivue can discover your AI coding sessions.
                      </p>
                      <p className="text-xs text-gh-text-secondary text-center leading-relaxed">
                        Supported: OpenCode, Copilot, Cursor, Pi, Codex
                      </p>
                      <div className="w-full">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyInit("omnivue init");
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-gh-border bg-gh-bg-secondary text-xs font-mono text-gh-text select-none cursor-pointer transition-colors hover:bg-gh-bg-hover"
                          title="Copy command"
                        >
                          <span className="flex-1 text-left">$ omnivue init</span>
                          {initCopied ? (
                            <Check className="size-3.5 shrink-0 text-emerald-400" />
                          ) : (
                            <Copy className="size-3.5 shrink-0 text-gh-text-secondary" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-gh-text-secondary">or</p>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(true)}
                        className="text-xs px-3 py-1.5 rounded-md border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 cursor-pointer transition-colors"
                      >
                        Go to Settings
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <svg
                        className="size-6"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                      <p className="text-sm font-medium text-gh-text">Select a session</p>
                      <p className="text-xs text-gh-text-secondary max-w-xs">
                        Pick a session from the sidebar to view conversation, plan, and diffs.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>
        </SessionNavContext.Provider>

        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <Modal
          isOpen={pinningContent !== null}
          onClose={handleCancelPin}
          title="Pin Message"
          size="md"
        >
          {pinningContent && (
            <div className="p-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-gh-text-secondary block mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={pinTitle}
                  onChange={(e) => setPinTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm rounded border border-gh-border bg-gh-bg text-gh-text focus:outline-none focus:border-accent-border"
                  placeholder="Pinned message"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gh-text-secondary block mb-1">
                  Preview
                </label>
                <div className="max-h-32 overflow-y-auto p-2 rounded border border-gh-border bg-gh-bg-secondary/50 text-xs text-gh-text-secondary whitespace-pre-wrap leading-relaxed">
                  {pinningContent.slice(0, 500)}
                  {pinningContent.length > 500 && (
                    <span className="text-gh-text-secondary/50">...</span>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelPin}
                  className="px-3 py-1.5 text-xs rounded border border-gh-border text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPin}
                  className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent-secondary cursor-pointer transition-colors"
                >
                  Pin
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </ThemeProvider>
  );
}
