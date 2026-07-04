import type { AppNotification, NotificationSettings } from "../hooks/types";

/**
 * Returns true if a browser (OS-level) notification should be fired for the
 * given notification under the current settings. Requires the user to have
 * granted permission, enabled browser notifications, and the tab to be hidden.
 */
export function canBrowserNotify(settings: NotificationSettings | null): boolean {
  if (!settings || !settings.browserNotify) return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  return document.hidden;
}

/**
 * Fires a browser OS notification for an in-app notification. Clicking the
 * notification focuses the window.
 */
export function fireBrowserNotification(n: AppNotification): void {
  if (typeof Notification === "undefined") return;
  try {
    const notif = new Notification(n.title, {
      body: n.preview || "",
      tag: n.id,
      silent: false,
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch {
    // Some browsers throw if the page isn't focused enough; ignore.
  }
}

/**
 * Returns true if notifications should be suppressed right now due to quiet
 * hours. Attention-severity notifications (agent questions) bypass quiet hours
 * because the agent is blocked waiting for the user.
 */
export function inQuietHours(settings: NotificationSettings | null): boolean {
  if (!settings || !settings.quietHoursEnabled) return false;
  const start = parseHHMM(settings.quietHoursStart);
  const end = parseHHMM(settings.quietHoursEnd);
  if (start === null || end === null) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // Overnight window (crosses midnight).
  return cur >= start || cur < end;
}

function parseHHMM(s: string): number | null {
  const parts = s.split(":");
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Decides whether to surface a notification to the user via toast/browser given
 * settings and quiet hours. Returns the channels to use.
 */
export function resolveChannels(
  n: AppNotification,
  settings: NotificationSettings | null,
): { toast: boolean; browser: boolean } {
  if (!settings || !settings.enabled) return { toast: false, browser: false };
  const quiet = inQuietHours(settings);
  const bypassQuiet = n.severity === "attention";
  const allowToast = settings.inAppToast && (!quiet || bypassQuiet);
  const allowBrowser =
    settings.browserNotify && canBrowserNotify(settings) && (!quiet || bypassQuiet);
  return { toast: allowToast, browser: allowBrowser };
}
