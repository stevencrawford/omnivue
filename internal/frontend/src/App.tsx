import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionViewer } from "./components/SessionViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { SearchPanel } from "./components/SearchPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Tab } from "./components/SessionViewer";
import { useSSE } from "./hooks/useSSE";
import { SessionNavContext } from "./hooks/useNav";
import { ThemeProvider } from "./hooks/useTheme";
import type { Session } from "./hooks/useApi";
import {
  fetchSessions,
  createScratchFile,
  deleteScratchFile,
  renameScratchFile,
} from "./hooks/useApi";
import type { ScratchFile } from "./hooks/useApi";
import { fetchAllScratchFiles } from "./hooks/useApi";

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusStepIndex, setFocusStepIndex] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("session");
  const [scratchFiles, setScratchFiles] = useState<ScratchFile[]>([]);
  const [openScratchTabs, setOpenScratchTabs] = useState<string[]>([]);
  const [liveChangedIds, setLiveChangedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSessionScope, setSearchSessionScope] = useState<string | null>(null);
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null);
  const scrollPositions = useRef(new Map<string, number>());

  const saveScrollPosition = useCallback((id: string, pos: number) => {
    scrollPositions.current.set(id, pos);
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

  useEffect(() => {
    loadSessions();
    loadScratchFiles();
  }, [loadSessions, loadScratchFiles]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setSearchOpen((v) => {
          if (!v) {
            setSearchSessionScope(activeSessionId);
          }
          return !v;
        });
        return;
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        return;
      }

      if (searchOpen) return;

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
  }, [searchOpen, sessions]);

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
  const isInitialHashRef = useRef(true);
  useEffect(() => {
    if (isInitialHashRef.current) {
      isInitialHashRef.current = false;
      return;
    }
    setFocusStepIndex(undefined);
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const scratchFileMap = useMemo(() => {
    const map: Record<string, { title: string }> = {};
    for (const f of scratchFiles) {
      map[f.id] = { title: f.title };
    }
    return map;
  }, [scratchFiles]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      setFocusStepIndex(undefined);
      setActiveTab("session");
      setSearchHighlightQuery(null);
    },
    [],
  );

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

  const handleDeleteScratchFile = useCallback(
    async (sessionId: string, fileId: string) => {
      try {
        await deleteScratchFile(sessionId, fileId);
      } catch {
        return;
      }
      setScratchFiles((prev) => prev.filter((f) => f.id !== fileId));
      setOpenScratchTabs((prev) => prev.filter((id) => id !== fileId));
      const tab: Tab = `scratch:${fileId}`;
      if (activeTab === tab && activeSession) {
        setActiveTab("session");
      }
    },
    [activeTab, activeSession],
  );

  const handleRenameScratchFile = useCallback(
    async (sessionId: string, fileId: string, newTitle: string) => {
      try {
        await renameScratchFile(sessionId, fileId, newTitle);
      } catch {
        return;
      }
      setScratchFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, title: newTitle } : f)));
    },
    [],
  );

  const handleOpenScratchFile = useCallback((sessionId: string, fileId: string) => {
    setActiveSessionId(sessionId);
    setOpenScratchTabs((prev) => (prev.includes(fileId) ? prev : [...prev, fileId]));
    setActiveTab(`scratch:${fileId}`);
  }, []);

  const handleSearchSelect = useCallback(
    (sessionId: string, chunkType: string, query: string) => {
      setActiveSessionId(sessionId);
      setActiveTab(chunkType === "plan" ? "plan" : "session");
      setSearchHighlightQuery(query || null);
      setSearchOpen(false);
    },
    [],
  );

  const isMac = typeof navigator !== "undefined" && navigator.platform?.includes("Mac");

  return (
    <ThemeProvider>
    <div className="flex flex-col h-full font-sans text-gh-text bg-gh-bg">
      <header className="sess-glass h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 border-b border-gh-header-border">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            className="sess-icon-btn shrink-0"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
            title="Toggle sidebar"
          >
            <svg
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              {sidebarOpen ? (
                <polyline points="6,10 4,12 6,14" />
              ) : (
                <polyline points="5,10 7,12 5,14" />
              )}
            </svg>
          </button>
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-sm font-semibold sess-gradient-text tracking-tight">sess</h1>
          </div>
        </div>

        <button type="button" className="sess-search-trigger" onClick={() => setSearchOpen(true)}>
          <svg className="size-3.5 shrink-0 opacity-60" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
          </svg>
          <span className="flex-1 text-left">Search sessions...</span>
          <span className="sess-kbd">{isMac ? "⌘" : "Ctrl"}P</span>
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
          onClose={() => setSearchOpen(false)}
          searchScope={searchSessionScope}
          searchScopeName={(() => {
            if (!searchSessionScope) return null;
            const s = sessions.find((s) => s.id === searchSessionScope);
            return s?.title || s?.repository || null;
          })()}
          onClearScope={() => setSearchSessionScope(null)}
        />
      )}

      <SessionNavContext.Provider
        value={{
          navigateToSession: handleSessionSelect,
          scrollPositions: scrollPositions.current,
          saveScrollPosition,
        }}
      >
        <div className="flex flex-1 overflow-hidden">
          {sidebarOpen && (
            <ErrorBoundary>
              <Sidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSessionSelect={handleSessionSelect}
                onScratchFileSelect={handleOpenScratchFile}
                onDeleteScratchFile={handleDeleteScratchFile}
                onRenameScratchFile={handleRenameScratchFile}
                scratchFiles={scratchFiles}
              />
            </ErrorBoundary>
          )}
          <main className="flex-1 flex flex-col overflow-hidden sess-main-canvas">
            {activeSession ? (
              <ErrorBoundary>
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
                  focusStepIndex={focusStepIndex}
                  searchHighlightQuery={searchHighlightQuery}
                />
              </ErrorBoundary>
            ) : (
              <div className="sess-empty-state flex-1 h-full">
                <div className="sess-empty-icon">
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
                </div>
                <p className="text-sm font-medium text-gh-text">
                  {sessions.length === 0 ? "No sessions yet" : "Select a session"}
                </p>
                <p className="text-xs text-gh-text-secondary max-w-xs">
                  {sessions.length === 0
                    ? "Run sess init to discover OpenCode, Copilot, and other agent sources."
                    : "Pick a session from the sidebar to view conversation, plan, and diffs."}
                </p>
              </div>
            )}
          </main>
        </div>
      </SessionNavContext.Provider>
    </div>
    </ThemeProvider>
  );
}
