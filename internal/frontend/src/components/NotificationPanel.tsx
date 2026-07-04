import { useMemo, useState } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import type { AppNotification, Session } from "../hooks/types";
import { NotificationRow } from "./NotificationRow";

interface NotificationPanelProps {
  notifications: AppNotification[];
  sessions: Session[];
  onNotificationClick: (n: AppNotification) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

type Filter = "all" | "questions" | "activity";

const QUESTION_KINDS = new Set(["question"]);
const ACTIVITY_KINDS = new Set([
  "new_messages",
  "new_tool_call",
  "status_active",
  "status_completed",
  "status_error",
  "task_complete",
]);

export function NotificationPanel({
  notifications,
  sessions,
  onNotificationClick,
  onMarkAllRead,
  onClearAll,
}: NotificationPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const sessionTitleByID = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sessions) m[s.id] = s.title;
    return m;
  }, [sessions]);

  const filtered = useMemo(() => {
    if (filter === "all") return notifications;
    const set = filter === "questions" ? QUESTION_KINDS : ACTIVITY_KINDS;
    return notifications.filter((n) => set.has(n.kind));
  }, [notifications, filter]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border shrink-0">
        <Bell className="size-4 text-accent" />
        <span className="text-xs font-semibold text-ov-text">Notifications</span>
        {unreadCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-white">
            {unreadCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            title="Mark all read"
            className="p-1 text-ov-text-secondary hover:text-ov-text disabled:opacity-30 cursor-pointer transition-colors"
          >
            <CheckCheck className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={notifications.length === 0}
            title="Clear all"
            className="p-1 text-ov-text-secondary hover:text-red-400 disabled:opacity-30 cursor-pointer transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-ov-border shrink-0">
        {(["all", "questions", "activity"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer transition-colors capitalize ${
              filter === f
                ? "bg-accent-muted text-accent"
                : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <Bell className="size-8 text-ov-text-secondary/40 mb-2" />
            <p className="text-xs text-ov-text-secondary">
              No notifications. You&apos;ll see agent questions and new session activity here.
            </p>
          </div>
        ) : (
          filtered.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              sessionTitle={sessionTitleByID[n.sessionId]}
              onClick={onNotificationClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
