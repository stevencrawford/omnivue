import type { Session, Bookmark, AppNotification } from "../hooks/types";
import { IconChannel } from "./IconChannel";
import type { Section } from "./IconChannel";
import { SessionPanel } from "./SessionPanel";
import { TagPanel } from "./TagPanel";
import { BookmarkPanel } from "./BookmarkPanel";
import { NotificationPanel } from "./NotificationPanel";
import { QueuePanel } from "./QueuePanel";
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
    max: 600,
    defaultValue: 280,
  });

  const renderedWidth = sidebarOpen ? width : 48;
  const panelWidth = sidebarOpen ? Math.max(172, width - 48) : 0;

  return (
    <aside
      className={`flex shrink-0 relative ${sidebarOpen ? "border-r border-ov-border" : ""}`}
      style={{ width: `${renderedWidth}px` }}
    >
      <IconChannel
        activeSection={activeSection}
        onSectionChange={onSectionChange}
        onSettingsOpen={onSettingsOpen}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        notificationUnreadCount={notificationUnreadCount}
        queueCount={queueCount}
      />
      <div
        className={`flex-1 flex flex-col overflow-hidden bg-ov-bg-sidebar ${sidebarOpen ? "" : "hidden"}`}
        style={{ width: `${panelWidth}px` }}
      >
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "sessions" ? "hidden" : ""}`}
        >
          <SessionPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSessionSelect={onSessionSelect}
            sessionUnread={sessionUnread}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "queue" ? "hidden" : ""}`}
        >
          <QueuePanel
            sessions={sessions}
            promptVersion={promptVersion}
            onSessionSelect={onSessionSelect}
            onPromptClick={onPromptClick}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "tags" ? "hidden" : ""}`}
        >
          <TagPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSessionSelect={onSessionSelect}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "bookmarks" ? "hidden" : ""}`}
        >
          <BookmarkPanel
            bookmarks={bookmarks}
            sessions={sessions}
            onBookmarkSelect={onBookmarkSelect}
            onBookmarkDelete={onBookmarkDelete}
          />
        </div>
        <div
          className={`flex-1 flex flex-col overflow-hidden ${activeSection !== "notifications" ? "hidden" : ""}`}
        >
          <NotificationPanel
            notifications={notifications}
            sessions={sessions}
            onNotificationClick={onNotificationClick}
            onMarkAllRead={onMarkAllNotificationsRead}
            onClearAll={onClearNotifications}
          />
        </div>
      </div>
      {sidebarOpen && (
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors z-10 ${isResizing ? "bg-accent/50" : ""}`}
          onMouseDown={startResize}
        />
      )}
    </aside>
  );
}
