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
 * Decides whether to surface a notification to the user via toast/browser given
 * settings. Returns the channels to use.
 */
export function resolveChannels(settings: NotificationSettings | null): {
  toast: boolean;
  browser: boolean;
} {
  if (!settings || !settings.enabled) return { toast: false, browser: false };
  return {
    toast: settings.inAppToast,
    browser: settings.browserNotify && canBrowserNotify(settings),
  };
}
