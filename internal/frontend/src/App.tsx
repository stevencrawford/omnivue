import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionViewer } from "./components/SessionViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { SearchPanel } from "./components/SearchPanel";
import { useSSE } from "./hooks/useSSE";
import { useNewSessions } from "./hooks/useNewSessions";
import { SessionNavContext } from "./hooks/useNav";
import type { Session } from "./hooks/useApi";
import { fetchSessions } from "./hooks/useApi";

function SessLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="6" fill="url(#logo-bg)" />
      <path d="M7 8h10v1.5H7V8zm0 4h7v1.5H7v-1.5zm0 4h9v1.5H7V16z" fill="url(#logo-lines)" />
      <circle cx="18" cy="6" r="2" fill="#22D3EE" />
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="24" y2="24">
          <stop stopColor="#1a1a28" />
          <stop offset="1" stopColor="#12121c" />
        </linearGradient>
        <linearGradient id="logo-lines" x1="7" y1="8" x2="17" y2="17">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
    </svg>
  );
}

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

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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

  useSSE({
    onUpdate: () => {
      loadSessions();
    },
  });

  useEffect(() => {
    if (activeSessionId === null && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const { newSessionIds, markSessionSeen } = useNewSessions(sessions);

  useEffect(() => {
    if (activeSession) markSessionSeen(activeSession);
  }, [activeSession, markSessionSeen]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) markSessionSeen(session);
    },
    [sessions, markSessionSeen],
  );

  const handleSearchSelect = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      setSearchOpen(false);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) markSessionSeen(session);
    },
    [sessions, markSessionSeen],
  );

  const isMac =
    typeof navigator !== "undefined" && navigator.platform?.includes("Mac");

  return (
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
          <SessLogo className="size-7 shrink-0" />
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-sm font-semibold sess-gradient-text tracking-tight">sess</h1>
            <span className="text-[11px] text-gh-text-secondary truncate">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            </span>
          </div>
          {sessions.length > 0 && <span className="sess-live-dot shrink-0" title="Live sync" />}
        </div>

        <button
          type="button"
          className="sess-search-trigger"
          onClick={() => setSearchOpen(true)}
        >
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
              newSessionIds={newSessionIds}
            />
          )}
          <main className="flex-1 flex flex-col overflow-hidden sess-main-canvas">
            {activeSession ? (
              <SessionViewer session={activeSession} />
            ) : (
              <div className="sess-empty-state flex-1 h-full">
                <div className="sess-empty-icon">
                  <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
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
  );
}
