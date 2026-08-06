import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { SessionNavContext } from "./hooks/useNav";
import { SearchHighlightContext } from "./hooks/useSearchHighlightContext";
import { FocusContext, parseMessageTarget } from "./hooks/useFocus";
import { SessionListSettingsProvider } from "./hooks/useSessionListSettings";
import { TagsContext } from "./hooks/useTags";
import { ThemeProvider } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { type AppKeyboardConfig, useAppKeyboard } from "./hooks/useAppKeyboard";
import { useSessionRouting } from "./hooks/useSessionRouting";
import { useSearchScope } from "./hooks/useSearchScope";
import { useSearchState } from "./hooks/useSearchState";
import { useRecentSearches } from "./hooks/useRecentSearches";
import { useBookmarks } from "./hooks/useBookmarks";
import { useSessions, setOnPromptQueueChanged } from "./hooks/useSessions";
import { useScratchFiles } from "./hooks/useScratchFiles";
import { usePinMessage } from "./hooks/usePinMessage";
import { useNotifications, useActiveView } from "./hooks/useNotifications";
import { resolveChannels, fireBrowserNotification } from "./lib/browserNotify";
import type { AppNotification, Bookmark, NotificationSettings } from "./hooks/types";
import { useToast } from "./hooks/useToast";
import { fetchPrompts } from "./hooks/apiClient";

// ---------------------------------------------------------------------------
// App — root component
// ---------------------------------------------------------------------------

export function App() {
  // ---- Data hooks ----
  const {
    sessions,
    loading: sessionsLoading,
    activeSessionId,
    liveChangedIds,
    activeSession,
    setActiveSessionId,
    loadSessions,
  } = useSessions();

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

  // Report the currently-viewed session to the server so the
  // ExcludeActiveView notification setting can suppress alerts for it.
  useActiveView(activeSessionId);

  // ---- UI state ----
  const [showOverview, setShowOverview] = useState(true);
  const [focusStepIndex, setFocusStepIndex] = useState<number | undefined>(undefined);
  const [focusMessageIndex, setFocusMessageIndex] = useState<number | undefined>(undefined);
  const [focusMessageKey, setFocusMessageKey] = useState(0);
  const [focusMessageId, setFocusMessageId] = useState<string | undefined>(undefined);

  // jumpToMessage centralizes the focus-jump footgun: a messageId is a more
  // reliable target than an index (which can drift after grouping), so an
  // explicit messageId clears the index. Bumping the key re-triggers the
  // highlight effect even when the target index is unchanged.
  const jumpToMessage = useCallback(
    (target: { messageIndex?: number; messageId?: string; stepIndex?: number }) => {
      setFocusMessageIndex(target.messageId !== undefined ? undefined : target.messageIndex);
      setFocusMessageId(target.messageId);
      setFocusStepIndex(target.stepIndex);
      setFocusMessageKey((k) => k + 1);
    },
    [],
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHighlightQuery, setSearchHighlightQuery] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("session");
  const [activeSection, setActiveSection] = useState<Section>("sessions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [promptVersion, setPromptVersion] = useState(0);
  const [highlightPromptId, setHighlightPromptId] = useState<string | null>(null);

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
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const bumpTags = useCallback(() => setTagsVersion((v) => v + 1), []);
  const openTag = useCallback((name: string) => {
    setFilterTag(name);
    setActiveSection("tags");
    setSidebarOpen(true);
  }, []);
  const clearFilterTag = useCallback(() => setFilterTag(null), []);

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
    openTag,
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
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      setHighlightPromptId(null);
      setShowOverview(false);
      setActiveSessionId(sessionId);
      setActiveTab("session");
      setSearchHighlightQuery(null);
      // Reset any in-flight jump so a fresh session starts unhighlighted.
      setFocusStepIndex(undefined);
      setFocusMessageIndex(undefined);
      setFocusMessageId(undefined);
      setFocusMessageKey(0);
      // Mark all unread notifications for this session as read and
      // jump to the first notification's message if one exists.
      // If the user has already scrolled past that message (saved scroll),
      // skip the jump and let normal scroll restoration take them to where
      // they left off.
      const unreadForSession = notifications.filter((n) => n.sessionId === sessionId && !n.readAt);
      const ids = unreadForSession.map((n) => n.id);
      if (ids.length > 0) {
        markNotificationRead(ids);
        // Pick the earliest unread notification to jump to.
        const first = unreadForSession.sort((a, b) => a.createdAt - b.createdAt)[0];
        const savedPos = scrollPositions.current.get(sessionId);
        const hasSavedScroll = savedPos !== undefined && savedPos > 200;
        if (!hasSavedScroll) {
          jumpToMessage(parseMessageTarget(first.payload));
        }
      }
    },
    [notifications, markNotificationRead, jumpToMessage],
  );

  const handlePromptClick = useCallback(
    (sessionId: string, promptId: string) => {
      handleSessionSelect(sessionId);
      setHighlightPromptId(promptId);
    },
    [handleSessionSelect],
  );

  const handleHighlightDone = useCallback(() => {
    setHighlightPromptId(null);
  }, []);

  const handleClearFocus = useCallback(() => {
    setFocusMessageIndex(undefined);
    setFocusMessageId(undefined);
    setFocusMessageKey(0);
  }, []);

  const handleGoHome = useCallback(() => {
    setShowOverview(true);
    setActiveSessionId(null);
    setHighlightPromptId(null);
    setFocusStepIndex(undefined);
    setFocusMessageIndex(undefined);
    setSearchHighlightQuery(null);
    setActiveTab("session");
  }, []);

  const handleBookmarkSelect = useCallback(
    (bookmark: Bookmark) => {
      setShowOverview(false);
      setActiveSessionId(bookmark.sessionId);
      setSearchHighlightQuery(null);
      setActiveSection("sessions");
      if (bookmark.kind === "plan") {
        setActiveTab("plan");
      } else {
        jumpToMessage({ messageIndex: bookmark.messageIndex });
        setActiveTab("session");
      }
    },
    [jumpToMessage],
  );

  const handleDiffNavigateToMessage = useCallback(
    (messageIndex: number, messageId?: string) => {
      jumpToMessage({ messageIndex, messageId });
      setActiveTab("session");
    },
    [jumpToMessage],
  );

  const handleNotificationClick = useCallback(
    (n: AppNotification) => {
      setShowOverview(false);
      setActiveSessionId(n.sessionId);
      setActiveTab("session");
      setSearchHighlightQuery(null);
      markNotificationRead([n.id]);
      setActiveSection("sessions");
      // Parse the payload for a message index to jump directly to
      // the message that triggered the notification.
      jumpToMessage(parseMessageTarget(n.payload));
    },
    [markNotificationRead, jumpToMessage],
  );

  // ---- Render ----
  return (
    <ThemeProvider>
      <ToastProvider>
        <SessionListSettingsProvider>
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
                      onSectionChange={setActiveSection}
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
                          <FocusContext.Provider
                            value={{
                              focusStepIndex,
                              focusMessageIndex,
                              focusMessageKey,
                              focusMessageId,
                              jumpToMessage,
                              clearFocus: handleClearFocus,
                            }}
                          >
                            <SessionViewer
                              key={activeSession.id}
                              session={activeSession}
                              childSessions={sessions.filter(
                                (s) => s.parentId === activeSession.id,
                              )}
                              liveChangedIds={liveChangedIds}
                              activeTab={activeTab}
                              onTabChange={setActiveTab}
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
                          </FocusContext.Provider>
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
            </SessionNavContext.Provider>

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
  const seenIds = useRef<Set<string>>(new Set());

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
