import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SessionViewer, type Tab } from "./components/SessionViewer";
import { SearchPanel } from "./components/SearchPanel";
import { SearchResultsDrawer } from "./components/SearchResultsDrawer";
import { SettingsModal } from "./components/SettingsModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { OverviewScreen } from "./components/OverviewScreen";
import { AppHeader } from "./components/AppHeader";
import { EmptyState } from "./components/EmptyState";
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
import { useScratchFiles } from "./hooks/useScratchFiles";
import { usePinMessage } from "./hooks/usePinMessage";
import { useNotifications, useActiveView } from "./hooks/useNotifications";
import { resolveChannels, fireBrowserNotification } from "./lib/browserNotify";
import type { AppNotification, NotificationSettings } from "./hooks/types";
import { useToast } from "./hooks/useToast";
import { fetchPrompts } from "./hooks/apiClient";
import { NavigationContext, useNavigationState } from "./hooks/useNavigation";

// ---------------------------------------------------------------------------
// App — root component
// ---------------------------------------------------------------------------

export function App() {
  // ---- Data hooks ----
  const { sessions, loading: sessionsLoading, liveChangedIds, loadSessions } = useSessions();

  const { bookmarks, bookmarkIdByRef, handleBookmark, handleBookmarkDelete } = useBookmarks();

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
    searchHighlightQuery,
    highlightPromptId,
    filterTag,
    handleSessionSelect,
    handleBookmarkSelect,
    handleNotificationClick,
    handleDiffNavigateToMessage,
    handlePromptClick,
    handleHighlightDone,
    goHome,
    setTab,
    setSection,
    setShowOverview,
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

  // ---- Scratch files ----
  const {
    openScratchTabs,
    scratchFileMap,
    handleNewScratchFile,
    handleCloseScratchTab,
    handleRenameScratchFile,
    handlePinAsScratch,
  } = useScratchFiles(sessions, activeSessionId, activeTab, activeSession, (tab: string) =>
    setTab(tab as Tab),
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
              onGoHome={goHome}
              onOpenSearch={() => {
                if (searchHighlightQuery) setSearchInput(searchHighlightQuery);
                setSearchOpen(true);
              }}
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
                <div className="flex flex-1 overflow-hidden">
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
                          <SessionViewer
                            key={activeSession.id}
                            session={activeSession}
                            childSessions={sessions.filter((s) => s.parentId === activeSession.id)}
                            liveChangedIds={liveChangedIds}
                            activeTab={activeTab}
                            onTabChange={setTab}
                            onNameChanged={loadSessions}
                            openScratchTabs={openScratchTabs}
                            scratchFileMap={scratchFileMap}
                            onCloseScratchTab={handleCloseScratchTab}
                            onNewScratchFile={handleNewScratchFile}
                            onRenameScratchFile={handleRenameScratchFile}
                            onPinMessage={handlePinMessage}
                            onBookmark={handleBookmark}
                            bookmarkIdByRef={bookmarkIdByRef}
                            searchHighlightQuery={searchHighlightQuery}
                            onNavigateToMessage={handleDiffNavigateToMessage}
                            onQueueChanged={fetchQueueCount}
                            highlightPromptId={highlightPromptId}
                            onHighlightDone={handleHighlightDone}
                          />
                        </SearchHighlightContext.Provider>
                      </ErrorBoundary>
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
              onConfirm={() => handleConfirmPin(handlePinAsScratch)}
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
 * respecting the user's settings and quiet hours. Lives inside ToastProvider
 * so it can access the toast context.
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
      const { toast, browser } = resolveChannels(n, settings);
      if (toast) {
        const toastMsg =
          n.kind === "question" ? "Question" : `${n.title}${n.preview ? " — " + n.preview : ""}`;
        showToast(
          toastMsg,
          {
            label: "View",
            onClick: () => onNavigate(n.sessionId),
          },
          settings?.autoDismissSec ? settings.autoDismissSec * 1000 : undefined,
        );
      }
      if (browser) {
        fireBrowserNotification(n);
      }
    }
  }, [notifications, settings, activeSessionId, showToast, onNavigate]);

  return null;
}
