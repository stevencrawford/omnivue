import { useEffect, useMemo, useRef, useState } from "react";
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
  "exit_plan_mode",
]);

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "questions", label: "Questions" },
  { value: "activity", label: "Activity" },
];

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
      <div className="flex items-center justify-between px-1.5 py-1 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
          Notifications
        </span>
        <div className="flex items-center gap-0.5">
          {unreadCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-white">
              {unreadCount}
            </span>
          )}
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            title="Mark all read"
            className="text-ov-text-secondary hover:text-ov-text disabled:opacity-30 cursor-pointer p-0.5 rounded transition-colors"
          >
            <CheckCheck className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={notifications.length === 0}
            title="Clear all"
            className="text-ov-text-secondary hover:text-red-400 disabled:opacity-30 cursor-pointer p-0.5 rounded transition-colors"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="px-1.5 pb-1 shrink-0">
        <FilterChip
          label="Filter"
          value={filter}
          options={FILTER_OPTIONS}
          onChange={(v) => v && setFilter(v)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bell size={24} className="text-ov-text-secondary/40 mb-3" />
            <p className="text-xs text-ov-text-secondary/60 max-w-36 leading-relaxed">
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

// ─── FilterChip ──────────────────────────────────────────────────

function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Filter;
  options: { value: Filter; label: string }[];
  onChange: (value: Filter | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentLabel = options.find((o) => o.value === value)?.label ?? `All ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[11px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          value !== "all"
            ? "border-accent-border bg-accent-muted text-accent"
            : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
        }`}
      >
        {label}: {currentLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
                value === o.value
                  ? "text-ov-text bg-ov-bg-active"
                  : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
              }`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
