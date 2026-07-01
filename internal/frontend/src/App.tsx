import React, { useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import type { Section } from "./components/IconChannel";
import { SessionViewer } from "./components/SessionViewer";
import { SearchPanel } from "./components/SearchPanel";
import { SearchResultsDrawer } from "./components/SearchResultsDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { OverviewScreen } from "./components/OverviewScreen";
import { AppHeader } from "./components/AppHeader";
import { EmptyState } from "./components/EmptyState";
import { PinMessageModal } from "./components/PinMessageModal";
import type { Tab } from "./components/SessionViewer";
import { SessionNavContext, SearchHighlightContext } from "./hooks/useNav";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { type AppKeyboardConfig, useAppKeyboard } from "./hooks/useAppKeyboard";
import { useSessionRouting } from "./hooks/useSessionRouting";
import { useSearchScope } from "./hooks/useSearchScope";
import { useSearchState } from "./hooks/useSearchState";
import { useRecentSearches } from "./hooks/useRecentSearches";
import { useBookmarks } from "./hooks/useBookmarks";
import { useSessions } from "./hooks/useSessions";
import { useScratchFiles } from "./hooks/useScratchFiles";
import { usePinMessage } from "./hooks/usePinMessage";
import { useState } from "react";

// ---------------------------------------------------------------------------
// App — root component
// ---------------------------------------------------------------------------

export function App() {
  // ---- Data hooks ----
  const { sessions, activeSessionId, liveChangedIds, activeSession, setActiveSessionId } =
    useSessions();

  const { bookmarks, bookmarkIdByRef, handleBookmark, handleBookmarkDelete } = useBookmarks();

  // ---- UI state ----
  const [showOverview, setShowOverview] = useState(true);
  const [focusStepIndex, setFocusStepIndex] = useState<number | undefined>(undefined);
  const [focusMessageIndex, setFocusMessageIndex] = useState<number | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("session");
  const [activeSection, setActiveSection] = useState<Section>("sessions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { recentSearches, addSearch, clearSearches } = useRecentSearches();
  const { searchSessionScope, setSearchSessionScope, searchScopeName } = useSearchScope(sessions);
  const {
    drawerOpen,
    setDrawerOpen,
    drawerQuery,
    drawerResults,
    setDrawerResults,
    handleSearchSelect,
    handleSearchOpenDrawer,
    handleDrawerClose,
    handleDrawerClearScope,
  } = useSearchState(
    addSearch,
    searchSessionScope,
    setActiveSessionId,
    setActiveTab,
    setSearchHighlightQuery,
    setFocusStepIndex,
    setFocusMessageIndex,
    setShowOverview,
  );

  // ---- Scratch files ----
  const {
    openScratchTabs,
    scratchFileMap,
    handleNewScratchFile,
    handleCloseScratchTab,
    handleRenameScratchFile,
    handlePinAsScratch,
  } = useScratchFiles(sessions, activeSessionId, activeTab, activeSession, (tab: string) =>
    setActiveTab(tab as Tab),
  );

  // ---- Pin message modal ----
  const {
    pinningContent,
    pinTitle,
    setPinTitle,
    handlePinMessage,
    handleConfirmPin,
    handleCancelPin,
  } = usePinMessage();

  // ---- Keyboard shortcuts ----
  // Wrap setActiveSessionId as a dispatch to support functional updaters used in useAppKeyboard.
  const setActiveSessionIdDispatch = useCallback(
    (action: React.SetStateAction<string | null>) => {
      if (typeof action === "function") {
        setActiveSessionId(action(activeSessionId));
      } else {
        setActiveSessionId(action);
      }
    },
    [activeSessionId, setActiveSessionId],
  );

  const keyboardConfig: AppKeyboardConfig = {
    sessions,
    activeSessionId,
    searchOpen,
    drawerOpen,
    searchHighlightQuery,
    setSearchOpen,
    setSearchSessionScope,
    setDrawerOpen,
    setDrawerResults,
    setSearchHighlightQuery,
    setSidebarOpen,
    setActiveTab,
    setActiveSessionId: setActiveSessionIdDispatch,
    setFocusMessageIndex,
    setShowOverview,
    onOpenShortcuts: () => setShortcutsOpen(true),
  };
  useAppKeyboard(keyboardConfig);

  // ---- URL hash routing ----
  useSessionRouting(
    sessions,
    activeSessionId,
    (id: string | null) => setActiveSessionId(id),
    setFocusStepIndex,
    showOverview,
    setShowOverview,
  );

  // ---- Scroll position persistence ----
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

  // ---- Navigation handlers ----
  const handleSessionSelect = useCallback((sessionId: string) => {
    setShowOverview(false);
    setActiveSessionId(sessionId);
    setFocusStepIndex(undefined);
    setFocusMessageIndex(undefined);
    setActiveTab("session");
    setSearchHighlightQuery(null);
  }, []);

  const handleGoHome = useCallback(() => {
    setShowOverview(true);
    setActiveSessionId(null);
    setFocusStepIndex(undefined);
    setFocusMessageIndex(undefined);
    setSearchHighlightQuery(null);
    setActiveTab("session");
  }, []);

  const handleBookmarkSelect = useCallback(
    (sessionId: string, messageIndex: number, _toolCallId?: string) => {
      setShowOverview(false);
      setActiveSessionId(sessionId);
      setFocusMessageIndex(messageIndex);
      setFocusStepIndex(undefined);
      setActiveTab("session");
      setSearchHighlightQuery(null);
    },
    [],
  );

  // ---- Render ----
  return (
    <ThemeProvider>
      <ToastProvider>
        <div className="flex flex-col h-full font-sans text-ov-text bg-ov-bg">
          <AppHeader
            showOverview={showOverview}
            searchHighlightQuery={searchHighlightQuery}
            onGoHome={handleGoHome}
            onOpenSearch={() => {
              if (searchHighlightQuery) setSearchQuery(searchHighlightQuery);
              setSearchOpen(true);
            }}
            onClearSearchHighlight={() => {
              setSearchHighlightQuery(null);
              setFocusMessageIndex(undefined);
            }}
          />

          {searchOpen && (
            <SearchPanel
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onSelectSession={handleSearchSelect}
              onOpenDrawer={handleSearchOpenDrawer}
              onClose={() => setSearchOpen(false)}
              searchScope={searchSessionScope}
              searchScopeName={searchScopeName}
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
            searchScopeName={searchScopeName}
            onClearScope={() => {
              setSearchSessionScope(null);
              handleDrawerClearScope();
            }}
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
                {activeSession && !showOverview ? (
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
                ) : sessions.length > 0 && showOverview ? (
                  <OverviewScreen
                    sessions={sessions}
                    onSessionSelect={handleSessionSelect}
                    onOpenProjects={() => setActiveSection("projects")}
                  />
                ) : (
                  <EmptyState
                    sessionsCount={sessions.length}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                )}
              </main>
            </div>
          </SessionNavContext.Provider>

          <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

          <PinMessageModal
            pinningContent={pinningContent}
            pinTitle={pinTitle}
            onTitleChange={setPinTitle}
            onCancel={handleCancelPin}
            onConfirm={() => handleConfirmPin(handlePinAsScratch)}
          />
        </div>
      </ToastProvider>
    </ThemeProvider>
  );
}
