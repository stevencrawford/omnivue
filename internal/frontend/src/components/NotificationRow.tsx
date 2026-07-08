import {
  Bell,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Wrench,
  Activity,
} from "lucide-react";
import type { AppNotification } from "../hooks/types";

interface NotificationRowProps {
  notification: AppNotification;
  sessionTitle?: string;
  onClick: (n: AppNotification) => void;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function kindIcon(kind: AppNotification["kind"]) {
  switch (kind) {
    case "question":
      return <AlertCircle className="size-3.5 text-pink-400" />;
    case "permission_request":
      return <ShieldAlert className="size-3.5 text-amber-400" />;
    case "task_complete":
      return <CheckCircle2 className="size-3.5 text-emerald-400" />;
    case "new_messages":
      return <MessageSquare className="size-3.5 text-blue-400" />;
    case "new_tool_call":
      return <Wrench className="size-3.5 text-ov-text-secondary" />;
    case "status_active":
      return <Activity className="size-3.5 text-green-400" />;
    case "status_completed":
      return <CheckCircle2 className="size-3.5 text-ov-text-secondary" />;
    case "status_error":
      return <AlertCircle className="size-3.5 text-red-400" />;
    default:
      return <Bell className="size-3.5 text-ov-text-secondary" />;
  }
}

export function NotificationRow({ notification, sessionTitle, onClick }: NotificationRowProps) {
  const unread = !notification.readAt;
  const isQuestion = notification.kind === "question" || notification.kind === "permission_request";
  return (
    <button
      type="button"
      onClick={() => onClick(notification)}
      className={`w-full text-left flex gap-2 px-3 py-2 border-b border-ov-border/50 cursor-pointer transition-colors hover:bg-ov-bg-hover ${
        unread ? "bg-accent-muted/20" : "opacity-70"
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {unread ? (
          <span className="block size-2 rounded-full bg-accent mt-1" />
        ) : (
          <span className="block size-2 rounded-full border border-ov-text-secondary mt-1" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {kindIcon(notification.kind)}
          <span
            className={`truncate text-xs ${unread ? "font-semibold text-ov-text" : "text-ov-text-secondary"}`}
          >
            {isQuestion ? "Question" : notification.title}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-ov-text-secondary">
            {timeAgo(notification.createdAt)}
          </span>
        </div>
        {isQuestion ? (
          <>
            {notification.preview && (
              <p className="truncate text-[11px] text-ov-text-secondary mt-0.5">
                {notification.preview}
              </p>
            )}
            {sessionTitle && (
              <p className="truncate text-[11px] text-ov-text-secondary mt-0.5">{sessionTitle}</p>
            )}
          </>
        ) : (
          <>
            {sessionTitle && (
              <p className="truncate text-[11px] text-ov-text-secondary mt-0.5">{sessionTitle}</p>
            )}
            {notification.preview && (
              <p className="truncate text-[11px] text-ov-text-secondary mt-0.5">
                {notification.preview}
              </p>
            )}
          </>
        )}
      </div>
    </button>
  );
}
