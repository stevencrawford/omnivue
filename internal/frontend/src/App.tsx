import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionViewer } from "./components/SessionViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { SearchPanel } from "./components/SearchPanel";
import { useSSE } from "./hooks/useSSE";
import { SessionNavContext } from "./hooks/useNav";
import type { Session } from "./hooks/useApi";
import { fetchSessions } from "./hooks/useApi";

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const scrollPositions = useRef(new Map<string, number>());

  const saveScrollPosition = useCallback((id: string, pos: number) => {
    scrollPositions.current.set(id, pos);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      setSessions(data || []);
    } catch {
      // server may not be ready yet
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  // SSE for live updates
  useSSE({
    onUpdate: () => {
      loadSessions();
    },
  });

  // Select first session if none active and sessions available
  useEffect(() => {
    if (activeSessionId === null && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const handleSessionSelect = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const handleSearchSelect = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setSearchOpen(false);
  }, []);

  return (
    <div className="flex flex-col h-full font-sans text-gh-text bg-gh-bg">
      <header className="h-12 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 bg-gh-header-bg text-gh-header-text border-b border-gh-header-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center justify-center bg-transparent border border-gh-border rounded-md p-1.5 cursor-pointer text-gh-header-text transition-colors duration-150 hover:bg-gh-bg-hover"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Sidebar"
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
          <h1 className="text-sm font-semibold tracking-wide">sess</h1>
          <span className="text-xs text-gh-text-secondary">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Search button - centered */}
        <button
          type="button"
          className="flex items-center gap-2 w-80 px-3 py-1.5 text-xs text-gh-text-secondary bg-gh-bg border border-gh-border rounded-md cursor-pointer transition-colors hover:bg-gh-bg-hover hover:text-gh-text"
          onClick={() => setSearchOpen(true)}
        >
          <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
          </svg>
          <span>Search sessions...</span>
          <span className="ml-auto text-[10px] px-1 py-0.5 rounded border border-gh-border">
            {(navigator as any).platform?.includes("Mac") ? "Cmd" : "Ctrl"}+P
          </span>
        </button>

        <div className="flex items-center justify-end gap-2">
          <ThemeToggle />
        </div>
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <SearchPanel onSelectSession={handleSearchSelect} onClose={() => setSearchOpen(false)} />
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
            <Sidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSessionSelect={handleSessionSelect}
            />
          )}
          <main className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden bg-gh-bg">
              {activeSession ? (
                <SessionViewer session={activeSession} />
              ) : (
                <div className="flex items-center justify-center h-full text-gh-text-secondary text-sm">
                  {sessions.length === 0
                    ? "No sessions found. Run 'sess init' to configure sources."
                    : "Select a session"}
                </div>
              )}
            </div>
          </main>
        </div>
      </SessionNavContext.Provider>
    </div>
  );
}
