import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import type { NotificationKind, NotificationSettings } from "../hooks/types";
import { useNotificationPermission } from "../hooks/useNotificationPermission";

interface NotificationsSettingsTabProps {
  settings: NotificationSettings | null;
  onSave: (settings: NotificationSettings) => void;
}

const KIND_OPTIONS: { value: NotificationKind; label: string }[] = [
  { value: "question", label: "Agent questions (question/ask)" },
  { value: "exit_plan_mode", label: "Plan mode exited (exit_plan_mode)" },
  { value: "permission_request", label: "Permission requests (permission_request)" },
  { value: "task_complete", label: "Task completion (task_complete)" },
  { value: "new_messages", label: "New messages in sessions" },
  { value: "new_tool_call", label: "New tool calls" },
  { value: "status_active", label: "Session became active" },
  { value: "status_completed", label: "Session completed" },
  { value: "status_error", label: "Session errored" },
];

const SCOPE_OPTIONS: { value: NotificationSettings["scope"]; label: string }[] = [
  { value: "all", label: "All sessions" },
  { value: "opened", label: "Only sessions I've opened" },
  { value: "pinned", label: "Only sessions in folders" },
];

export function NotificationsSettingsTab({ settings, onSave }: NotificationsSettingsTabProps) {
  const [local, setLocal] = useState<NotificationSettings | null>(settings);
  const { permission, request } = useNotificationPermission();

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  if (!local) {
    return <p className="text-xs text-ov-text-secondary">Loading…</p>;
  }

  const update = (patch: Partial<NotificationSettings>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    onSave(next);
  };

  const toggleKind = (k: NotificationKind) => {
    const has = local.kinds.includes(k);
    const kinds = has ? local.kinds.filter((x) => x !== k) : [...local.kinds, k];
    update({ kinds });
  };

  const browserDisabled = permission === "denied" || permission === "unsupported";

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Notifications
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Get alerted when an agent asks you a question or when sessions have new activity. Off by
        default — you control what triggers an alert.
      </p>

      {/* Master toggle */}
      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={local.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-accent"
        />
        <span className="text-xs text-ov-text font-medium">Enable notifications</span>
      </label>

      <div className={`space-y-4 ${local.enabled ? "" : "opacity-50 pointer-events-none"}`}>
        {/* What */}
        <div>
          <p className="text-[11px] font-medium text-ov-text-secondary mb-1.5">
            What to notify about
          </p>
          <div className="space-y-1">
            {KIND_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={local.kinds.includes(opt.value)}
                  onChange={() => toggleKind(opt.value)}
                  className="accent-accent"
                />
                <span className="text-xs text-ov-text">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div>
          <p className="text-[11px] font-medium text-ov-text-secondary mb-1.5">Which sessions</p>
          <div className="flex flex-col gap-1">
            {SCOPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="notif-scope"
                  checked={local.scope === opt.value}
                  onChange={() => update({ scope: opt.value })}
                  className="accent-accent"
                />
                <span className="text-xs text-ov-text">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* How */}
        <div>
          <p className="text-[11px] font-medium text-ov-text-secondary mb-1.5">How</p>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={local.inAppToast}
                onChange={(e) => update({ inAppToast: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-xs text-ov-text">In-app toast</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={local.sidebarBadge}
                onChange={(e) => update({ sidebarBadge: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-xs text-ov-text">Unread badge in sidebar</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={local.browserNotify}
                disabled={browserDisabled}
                onChange={(e) => update({ browserNotify: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-xs text-ov-text">
                Browser notification {permission === "denied" ? "(denied)" : "(when tab hidden)"}
              </span>
              {permission !== "granted" && !browserDisabled && (
                <button
                  type="button"
                  onClick={request}
                  className="text-[11px] px-2 py-0.5 rounded border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 cursor-pointer transition-colors"
                >
                  Grant
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer ml-6">
              <input
                type="checkbox"
                checked={local.excludeActiveView}
                onChange={(e) => update({ excludeActiveView: e.target.checked })}
                className="accent-accent"
              />
              <span className="text-xs text-ov-text-secondary">
                Don&apos;t notify for the session I&apos;m currently viewing
              </span>
            </label>
          </div>
        </div>

        {/* Quiet hours */}
        <div>
          <p className="text-[11px] font-medium text-ov-text-secondary mb-1.5">Quiet hours</p>
          <label className="flex items-center gap-2 cursor-pointer mb-1.5">
            <input
              type="checkbox"
              checked={local.quietHoursEnabled}
              onChange={(e) => update({ quietHoursEnabled: e.target.checked })}
              className="accent-accent"
            />
            <span className="text-xs text-ov-text">
              Suppress non-urgent alerts during quiet hours
            </span>
          </label>
          <div
            className={`flex items-center gap-2 ml-6 ${local.quietHoursEnabled ? "" : "opacity-50 pointer-events-none"}`}
          >
            <input
              type="time"
              value={local.quietHoursStart}
              onChange={(e) => update({ quietHoursStart: e.target.value })}
              className="text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1 text-ov-text outline-none focus:border-accent"
            />
            <span className="text-xs text-ov-text-secondary">→</span>
            <input
              type="time"
              value={local.quietHoursEnd}
              onChange={(e) => update({ quietHoursEnd: e.target.value })}
              className="text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1 text-ov-text outline-none focus:border-accent"
            />
            <span className="text-[10px] text-ov-text-secondary">
              Agent questions still surface
            </span>
          </div>
        </div>

        {/* Auto-dismiss */}
        <div>
          <p className="text-[11px] font-medium text-ov-text-secondary mb-1.5">
            Auto-dismiss toast
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="number"
              min={0}
              max={120}
              value={local.autoDismissSec}
              onChange={(e) => update({ autoDismissSec: Number(e.target.value) })}
              className="w-16 text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1 text-ov-text outline-none focus:border-accent"
            />
            <span className="text-xs text-ov-text-secondary">seconds (0 = sticky)</span>
          </label>
        </div>
      </div>

      {local.enabled && (
        <p className="text-[11px] text-ov-text-secondary mt-3 flex items-center gap-1">
          <Bell className="size-3" />
          Notifications are active. Changes save automatically.
        </p>
      )}
    </div>
  );
}
