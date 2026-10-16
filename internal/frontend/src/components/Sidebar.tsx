import type { Session, Bookmark, AppNotification } from "../hooks/types";
import { IconChannel } from "./IconChannel";
import type { Section } from "./IconChannel";
import { SessionPanel } from "./SessionPanel";
import { TagPanel } from "./TagPanel";
import { BookmarkPanel } from "./BookmarkPanel";
import { NotificationPanel } from "./NotificationPanel";
import { QueuePanel } from "./QueuePanel";
import { useCallback, useEffect, useRef } from "react";
import { useResizable } from "../hooks/useResizable";
import { STORAGE_KEYS } from "../utils/storageKeys";

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  onSettingsOpen: () => void;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  bookmarks: Bookmark[];
  onBookmarkSelect: (bookmark: Bookmark) => void;
  onBookmarkDelete: (id: string) => void;
  notifications: AppNotification[];
  notificationUnreadCount: number;
  sessionUnread: Record<string, number>;
  onNotificationClick: (n: AppNotification) => void;
  onMarkAllNotificationsRead: () => void;
  onClearNotifications: () => void;
  queueCount?: number;
  promptVersion?: number;
  onPromptClick?: (sessionId: string, promptId: string) => void;
}

const SIDEBAR_WIDTH_KEY = STORAGE_KEYS.SIDEBAR_WIDTH;

export function Sidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  activeSection,
  onSectionChange,
  onSettingsOpen,
  sidebarOpen,
  onSidebarToggle,
  bookmarks,
  onBookmarkSelect,
  onBookmarkDelete,
  notifications,
  notificationUnreadCount,
  sessionUnread,
  onNotificationClick,
  onMarkAllNotificationsRead,
  onClearNotifications,
  queueCount = 0,
  promptVersion = 0,
  onPromptClick,
}: SidebarProps) {
  const {
    value: width,
    isResizing,
    startResize,
  } = useResizable({
    storageKey: SIDEBAR_WIDTH_KEY,
    axis: "horizontal",
    min: 220,
    max: 750,
    defaultValue: 280,
  });

  const panelWidth = sidebarOpen ? Math.max(172, width - 48) : 0;
  const hasAutoClosedRef = useRef(false);
  const hoverCloseRef = useRef<number | null>(null);
  const sectionHoverRef = useRef<number | null>(null);

  const SECTION_HOVER_DELAY = 120;

  const cancelHoverClose = useCallback(() => {
    if (hoverCloseRef.current !== null) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (!sidebarOpen) return;
    cancelHoverClose();
    hoverCloseRef.current = window.setTimeout(() => {
      onSidebarToggle();
    }, 300);
  }, [sidebarOpen, onSidebarToggle, cancelHoverClose]);

  const cancelSectionHover = useCallback(() => {
    if (sectionHoverRef.current !== null) {
      clearTimeout(sectionHoverRef.current);
      sectionHoverRef.current = null;
    }
  }, []);

  const handlePanelEnter = useCallback(() => {
    cancelHoverClose();
    cancelSectionHover();
  }, [cancelHoverClose, cancelSectionHover]);

  const handleCinematicLeave = useCallback(() => {
    cancelSectionHover();
    scheduleHoverClose();
  }, [cancelSectionHover, scheduleHoverClose]);

  useEffect(() => {
    return () => {
      if (hoverCloseRef.current !== null) clearTimeout(hoverCloseRef.current);
      if (sectionHoverRef.current !== null) clearTimeout(sectionHoverRef.current);
    };
  }, []);

  const handleSectionHover = useCallback(
    (section: Section) => {
      if (!sidebarOpen) {
        cancelSectionHover();
        if (activeSection !== section) onSectionChange(section);
        onSidebarToggle();
        cancelHoverClose();
        return;
      }
      if (section === activeSection) {
        cancelSectionHover();
        cancelHoverClose();
        return;
      }
      cancelSectionHover();
      sectionHoverRef.current = window.setTimeout(() => {
        onSectionChange(section);
        sectionHoverRef.current = null;
      }, SECTION_HOVER_DELAY);
      cancelHoverClose();
    },
    [
      sidebarOpen,
      activeSection,
      onSectionChange,
      onSidebarToggle,
      cancelHoverClose,
      cancelSectionHover,
    ],
  );

  const handleSectionFocus = useCallback(
    (section: Section) => {
      cancelSectionHover();
      if (!sidebarOpen) {
        if (activeSection !== section) onSectionChange(section);
        onSidebarToggle();
      } else if (activeSection !== section) {
        onSectionChange(section);
      }
      cancelHoverClose();
    },
    [
      sidebarOpen,
      activeSection,
      onSectionChange,
      onSidebarToggle,
      cancelHoverClose,
      cancelSectionHover,
    ],
  );

  useEffect(() => {
    if (!hasAutoClosedRef.current && activeSessionId === null && sidebarOpen) {
      hasAutoClosedRef.current = true;
      onSidebarToggle();
    }
    if (activeSessionId !== null) {
      hasAutoClosedRef.current = true;
    }
  }, [activeSessionId, sidebarOpen, onSidebarToggle]);

  const closeOnSelect = useCallback(() => {
    if (sidebarOpen) onSidebarToggle();
  }, [sidebarOpen, onSidebarToggle]);

  const handleSessionSelectWrapped = useCallback(
    (id: string) => {
      onSessionSelect(id);
      closeOnSelect();
    },
    [onSessionSelect, closeOnSelect],
  );

  const handlePromptClickWrapped = useCallback(
    (sessionId: string, promptId: string) => {
      onPromptClick?.(sessionId, promptId);
      closeOnSelect();
    },
    [onPromptClick, closeOnSelect],
  );

  const handleBookmarkSelectWrapped = useCallback(
    (b: Bookmark) => {
      onBookmarkSelect(b);
      closeOnSelect();
    },
    [onBookmarkSelect, closeOnSelect],
  );

  const handleNotificationClickWrapped = useCallback(
    (n: AppNotification) => {
      onNotificationClick(n);
      closeOnSelect();
    },
    [onNotificationClick, closeOnSelect],
  );

  const panels = (
    <>
      <div
        className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "sessions" ? "hidden" : ""}`}
      >
        <SessionPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={handleSessionSelectWrapped}
          sessionUnread={sessionUnread}
        />
      </div>
      <div
        className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "queue" ? "hidden" : ""}`}
      >
        <QueuePanel
          sessions={sessions}
          promptVersion={promptVersion}
          onSessionSelect={handleSessionSelectWrapped}
          onPromptClick={handlePromptClickWrapped}
        />
      </div>
      <div
        className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "tags" ? "hidden" : ""}`}
      >
        <TagPanel
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={handleSessionSelectWrapped}
        />
      </div>
      <div
        className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "bookmarks" ? "hidden" : ""}`}
      >
        <BookmarkPanel
          bookmarks={bookmarks}
          sessions={sessions}
          onBookmarkSelect={handleBookmarkSelectWrapped}
          onBookmarkDelete={onBookmarkDelete}
        />
      </div>
      <div
        className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "notifications" ? "hidden" : ""}`}
      >
        <NotificationPanel
          notifications={notifications}
          sessions={sessions}
          onNotificationClick={handleNotificationClickWrapped}
          onMarkAllRead={onMarkAllNotificationsRead}
          onClearAll={onClearNotifications}
        />
      </div>
    </>
  );

  return (
    <>
      <aside
        className="flex shrink-0 relative"
        style={{ width: "48px" }}
        onMouseEnter={handlePanelEnter}
        onMouseLeave={handleCinematicLeave}
      >
        <IconChannel
          activeSection={activeSection}
          onSectionChange={onSectionChange}
          onSettingsOpen={onSettingsOpen}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={onSidebarToggle}
          notificationUnreadCount={notificationUnreadCount}
          queueCount={queueCount}
          onSectionHover={handleSectionHover}
          onSectionHoverCancel={cancelSectionHover}
          onSectionFocus={handleSectionFocus}
        />
      </aside>
      {sidebarOpen && (
        <>
          <div
            className="absolute inset-0 left-12 z-20 bg-black/55"
            onClick={onSidebarToggle}
            aria-hidden="true"
          />
          <div
            className="absolute left-12 top-0 bottom-0 z-30 flex flex-col bg-ov-bg-sidebar border-r border-ov-border shadow-xl overflow-hidden"
            style={{ width: `${panelWidth}px` }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={handlePanelEnter}
            onMouseLeave={handleCinematicLeave}
          >
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">{panels}</div>
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors z-10 ${isResizing ? "bg-accent/50" : ""}`}
              onMouseDown={startResize}
            />
          </div>
        </>
      )}
    </>
  );
}
