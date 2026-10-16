import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { CinematicSessionView } from "./components/cinematic/CinematicSessionView";
import { SearchPanel } from "./components/SearchPanel";
import { SearchResultsDrawer } from "./components/SearchResultsDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { OverviewScreen } from "./components/OverviewScreen";
import { AppHeader } from "./components/AppHeader";
import { EmptyState } from "./components/ui/EmptyState";
import { LoadingState } from "./components/ui/LoadingState";
import { PinMessageModal } from "./components/PinMessageModal";
import { SearchHighlightContext } from "./hooks/useSearchHighlightContext";
import { SessionListSettingsProvider } from "./hooks/useSessionListSettings";
import { TagsContext } from "./hooks/useTags";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { useAppKeyboard, type AppKeyboardConfig } from "./hooks/useAppKeyboard";
import { useSearchScope } from "./hooks/useSearchScope";
import { useSearchState } from "./hooks/useSearchState";
import { useRecentSearches } from "./hooks/useRecentSearches";
import { useBookmarks } from "./hooks/useBookmarks";
import { useSessions, setOnPromptQueueChanged } from "./hooks/useSessions";
import { useStatus } from "./hooks/useStatus";
import { useScratchFiles } from "./hooks/useScratchFiles";
import { usePinMessage } from "./hooks/usePinMessage";
import { useNotifications, useActiveView } from "./hooks/useNotifications";
import { resolveChannels, fireBrowserNotification } from "./lib/browserNotify";
import type { AppNotification, NotificationSettings } from "./hooks/types";
import { useToast } from "./hooks/useToast";
import { fetchPrompts } from "./hooks/apiClient";
import { NavigationContext, useNavigationState } from "./hooks/useNavigation";
import { SEARCH_ROUTE, pathToRoute } from "./hooks/useRouteSync";

// ---------------------------------------------------------------------------
// App — root component
// ---------------------------------------------------------------------------

export function App() {
  // ---- Data hooks ----
  const {
    sessions,
    loading: sessionsLoading,
    indexing,
    liveChangedIds,
    connected,
    loadSessions,
    ackSessionChange,
  } = useSessions();

  const { bookmarks, bookmarkIdByRef, handleBookmark, handleBookmarkDelete } = useBookmarks();

  const { status, reload: reloadStatus } = useStatus();

  const {
    notifications,
    unreadCount: notificationUnreadCount,
    settings: notificationSettings,
    sessionUnread: notificationSessionUnread,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    clearAll: clearAllNotifications,
    saveSettings: saveNotificationSettings,
  } = useNotifications();

  // ---- Navigation intent ----
  // One module owns selection, focus, tabs, and URL depth. Callers cross it
  // with intent verbs, never raw setters.
  const nav = useNavigationState({
    sessions,
    notifications,
    markNotificationRead,
  });

  const {
    activeSessionId,
    activeSession,
    showOverview,
    activeSection,
    activeTab,
    focusPosition,
    focusMessageIndex,
    focusMessageId,
    focusMessageKey,
    searchHighlightQuery,
    highlightPromptId,
    filterTag,
    handleSessionSelect,
    handleBookmarkSelect,
    handleNotificationClick,
    handlePromptClick,
    handleHighlightDone,
    goHome,
    setTab,
    setSection,
    setShowOverview,
    clearFocus,
    clearSearchHighlight,
    navigateSession,
    selectSearchHit,
    openTag: openTagNav,
    clearFilterTag,
  } = nav;

  // Report the currently-viewed session to the server so the
  // ExcludeActiveView notification setting can suppress alerts for it.
  useActiveView(activeSessionId);

  // ---- UI state ----
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [promptVersion, setPromptVersion] = useState(0);

  // ---- URL hash routing ----
  // Owned by useNavigationState above: useRouteSync (react-router) feeds the
  // navigation reducer, and every intent verb projects onto the hash through
  // navigateTo. Browser Back/Forward undo navigation because each destination
  // is a distinct history entry.

  const fetchQueueCount = useCallback(async () => {
    try {
      const prompts = await fetchPrompts("queued");
      setQueueCount(prompts.length);
      setPromptVersion((v) => v + 1);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setOnPromptQueueChanged(fetchQueueCount);
    fetchQueueCount();
    return () => setOnPromptQueueChanged(null);
  }, [fetchQueueCount]);

  // Refresh the reported version whenever the server reconnects so an upgraded
  // binary surfaces its new version without a manual page reload.
  const connectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !connectedRef.current) reloadStatus();
    connectedRef.current = connected;
  }, [connected, reloadStatus]);

  const [tagsVersion, setTagsVersion] = useState(0);

  const bumpTags = useCallback(() => setTagsVersion((v) => v + 1), []);
  const openTag = useCallback(
    (name: string) => {
      openTagNav(name);
      setSidebarOpen(true);
    },
    [openTagNav],
  );

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
  } = useSearchState({
    addSearch,
    searchSessionScope,
    onSelectHit: selectSearchHit,
    onOpenTag: openTag,
  });

  // ---- Search deep link ----
  // `#/search?q=...` opens the full-search drawer pre-filled with the query.
  // The bare /search route resolves to the overview view (see useRouteSync).
  const location = useLocation();

  // A session deep link (`#/session/<id>`) skips the initial-indexing
  // placeholder so it can land straight on the requested session.
  const isDeepLink = pathToRoute(location).sessionId !== null;

  useEffect(() => {
    if (location.pathname !== SEARCH_ROUTE) return;
    const q = new URLSearchParams(location.search).get("q");
    if (q) handleSearchOpenDrawer(q);
  }, [location.pathname, location.search, handleSearchOpenDrawer]);

  // ---- Scratch files ----
  // Cinematic owns its own scratch file list; the app-level hook now only backs
  // the "pin message as scratch" flow.
  const { handlePinAsScratch } = useScratchFiles(activeSessionId);

  // A freshly pinned scratch file id. The cinematic view focuses it (and reloads
  // its file list) when this changes.
  const [pinnedScratchId, setPinnedScratchId] = useState<string | null>(null);

  // Clear the pin focus when switching sessions so it only applies to the
  // session where the pin happened.
  useEffect(() => {
    setPinnedScratchId(null);
  }, [activeSessionId]);

  // ---- Pin message modal ----
  const {
    pinningContent,
    pinTitle,
    setPinTitle,
    handlePinMessage,
    handleConfirmPin,
    handleCancelPin,
  } = usePinMessage();

  // Opening search from the header mirrors the ⌘K shortcut: the search is
  // scoped to the open session (unscoped on overview) so the scope badge with
  // its dismiss control is always offered.
  const handleOpenSearch = useCallback(() => {
    if (searchHighlightQuery) setSearchInput(searchHighlightQuery);
    setSearchSessionScope(activeSessionId);
    setSearchOpen(true);
  }, [searchHighlightQuery, activeSessionId, setSearchSessionScope]);

  // ---- Keyboard shortcuts ----
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
    setSidebarOpen,
    setActiveTab: setTab,
    clearSearchHighlight,
    setShowOverview,
    navigateSession,
    onOpenShortcuts: () => setShortcutsOpen(true),
  };
  useAppKeyboard(keyboardConfig);

  // ---- Render ----
  return (
    <ThemeProvider>
      <ToastProvider>
        <SessionListSettingsProvider>
          <div className="flex flex-col h-full font-sans text-ov-text bg-ov-bg">
            <AppHeader
              showOverview={showOverview}
              searchHighlightQuery={searchHighlightQuery}
              connected={connected}
              version={status?.version}
              onGoHome={goHome}
              onOpenSearch={handleOpenSearch}
              onClearSearchHighlight={clearSearchHighlight}
            />

            {searchOpen && (
              <SearchPanel
                query={searchInput}
                onQueryChange={setSearchInput}
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

            <NavigationContext.Provider value={nav}>
              <TagsContext.Provider
                value={{
                  version: tagsVersion,
                  bump: bumpTags,
                  filterTag,
                  openTag,
                  clearFilter: clearFilterTag,
                }}
              >
                <div className="flex flex-1 overflow-hidden relative">
                  <ErrorBoundary>
                    <Sidebar
                      sessions={sessions}
                      activeSessionId={activeSessionId}
                      onSessionSelect={handleSessionSelect}
                      activeSection={activeSection}
                      onSectionChange={setSection}
                      onSettingsOpen={() => setSettingsOpen(true)}
                      sidebarOpen={sidebarOpen}
                      onSidebarToggle={() => setSidebarOpen((v) => !v)}
                      bookmarks={bookmarks}
                      onBookmarkSelect={handleBookmarkSelect}
                      onBookmarkDelete={handleBookmarkDelete}
                      notifications={notifications}
                      notificationUnreadCount={notificationUnreadCount}
                      sessionUnread={notificationSessionUnread}
                      onNotificationClick={handleNotificationClick}
                      onMarkAllNotificationsRead={markAllNotificationsRead}
                      onClearNotifications={clearAllNotifications}
                      queueCount={queueCount}
                      promptVersion={promptVersion}
                      onPromptClick={handlePromptClick}
                    />
                  </ErrorBoundary>
                  <main className="flex-1 flex flex-col overflow-hidden sess-main-canvas">
                    {activeSession && !showOverview ? (
                      <ErrorBoundary>
                        <SearchHighlightContext.Provider value={searchHighlightQuery ?? ""}>
                          <CinematicSessionView
                            key={activeSession.id + "-cinematic"}
                            session={activeSession}
                            liveChangedIds={liveChangedIds}
                            ackSessionChange={ackSessionChange}
                            onNameChanged={loadSessions}
                            onBookmark={handleBookmark}
                            bookmarkIdByRef={bookmarkIdByRef}
                            onQueueChanged={fetchQueueCount}
                            highlightPromptId={highlightPromptId}
                            onHighlightDone={handleHighlightDone}
                            onPinMessage={handlePinMessage}
                            pinnedScratchId={pinnedScratchId}
                            activeTab={activeTab}
                            focusPosition={focusPosition}
                            focusMessageIndex={focusMessageIndex}
                            focusMessageId={focusMessageId}
                            focusMessageKey={focusMessageKey}
                            onClearFocus={clearFocus}
                          />
                        </SearchHighlightContext.Provider>
                      </ErrorBoundary>
                    ) : !isDeepLink &&
                      indexing !== false &&
                      !sessionsLoading &&
                      sessions.length === 0 ? (
                      <LoadingState label="Indexing sessions..." />
                    ) : sessionsLoading && sessions.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-sm text-ov-text-secondary">
                          <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                          Loading sessions...
                        </div>
                      </div>
                    ) : sessions.length > 0 && showOverview ? (
                      <OverviewScreen sessions={sessions} onSessionSelect={handleSessionSelect} />
                    ) : (
                      <EmptyState
                        sessionsCount={sessions.length}
                        onOpenSettings={() => setSettingsOpen(true)}
                      />
                    )}
                  </main>
                </div>
              </TagsContext.Provider>
            </NavigationContext.Provider>

            <SettingsModal
              isOpen={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              notificationSettings={notificationSettings}
              onSaveNotificationSettings={saveNotificationSettings}
            />
            <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

            <PinMessageModal
              pinningContent={pinningContent}
              pinTitle={pinTitle}
              onTitleChange={setPinTitle}
              onCancel={handleCancelPin}
              onConfirm={() =>
                handleConfirmPin(async (title, content) => {
                  const f = await handlePinAsScratch(title, content);
                  if (f) setPinnedScratchId(f.id);
                })
              }
            />

            <NotificationToaster
              notifications={notifications}
              settings={notificationSettings}
              activeSessionId={activeSessionId}
              onNavigate={(sessionId) => handleSessionSelect(sessionId)}
            />
          </div>
        </SessionListSettingsProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/**
 * NotificationToaster subscribes to the notification list and fires in-app
 * toasts and browser OS notifications for newly-arrived unread notifications,
 * respecting the user's settings. Lives inside ToastProvider so it can access
 * the toast context.
 */
function NotificationToaster({
  notifications,
  settings,
  activeSessionId,
  onNavigate,
}: {
  notifications: AppNotification[];
  settings: NotificationSettings | null;
  activeSessionId: string | null;
  onNavigate: (sessionId: string) => void;
}) {
  const { showToast } = useToast();
  const seenIds = useRef(new Set<string>());

  useEffect(() => {
    for (const n of notifications) {
      if (seenIds.current.has(n.id)) continue;
      seenIds.current.add(n.id);
      if (n.readAt) continue;
      // Skip toast if excludeActiveView is on and user is already viewing this session.
      if (settings?.excludeActiveView && n.sessionId === activeSessionId) continue;
      const { toast, browser } = resolveChannels(settings);
      if (toast) {
        const toastMsg =
          n.kind === "question" ? "Question" : `${n.title}${n.preview ? " — " + n.preview : ""}`;
        showToast(toastMsg, {
          label: "View",
          onClick: () => onNavigate(n.sessionId),
        });
      }
      if (browser) {
        fireBrowserNotification(n);
      }
    }
  }, [notifications, settings, activeSessionId, showToast, onNavigate]);

  return null;
}
