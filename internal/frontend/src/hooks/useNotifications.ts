import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification, NotificationSettings } from "./types";
import {
  fetchNotifications,
  fetchNotificationSettings,
  markNotificationsRead,
  clearNotifications,
  setNotificationActiveView,
  setNotificationSettings,
} from "./apiClient";
import { useSSE } from "./useSSE";

export interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
  settings: NotificationSettings | null;
  loading: boolean;
  sessionUnread: Record<string, number>;
  reload: () => void;
  reloadSettings: () => Promise<void>;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  clearAll: () => void;
  saveSettings: (settings: NotificationSettings) => Promise<void>;
}

export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    fetchNotifications({ limit: 100 })
      .then((data) => {
        setNotifications(data || []);
      })
      .catch((err) => console.error("[notifications] reload failed:", err))
      .finally(() => setLoading(false));
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const s = await fetchNotificationSettings();
      setSettings(s);
    } catch (err) {
      console.error("Failed to load notification settings:", err);
    }
  }, []);

  // Debounced refetch on SSE notification events so a burst doesn't flood.
  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => reload(), 300);
  }, [reload]);

  useEffect(() => {
    reload();
    reloadSettings();
  }, [reload, reloadSettings]);

  // Periodic polling fallback: refresh every 60s so the frontend recovers
  // from dropped SSE events (e.g. tab backgrounded during delivery).
  useEffect(() => {
    const id = setInterval(() => reload(), 60000);
    return () => clearInterval(id);
  }, [reload]);

  useSSE({
    onUpdate: () => scheduleReload(),
    onNotification: () => scheduleReload(),
    onStarted: () => scheduleReload(),
    onNotificationsRead: (ids) => {
      if (ids === null) {
        setNotifications((prev) => prev.map((n) => ({ ...n, readAt: Date.now() })));
      } else {
        const set = new Set(ids);
        setNotifications((prev) =>
          prev.map((n) => (set.has(n.id) ? { ...n, readAt: Date.now() } : n)),
        );
      }
    },
  });

  const markRead = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => (set.has(n.id) ? { ...n, readAt: now } : n)));
    markNotificationsRead(ids).catch((err) => console.error("Failed to mark read:", err));
  }, []);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: now })));
    markNotificationsRead(null).catch((err) => console.error("Failed to mark all read:", err));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    clearNotifications().catch((err) => console.error("Failed to clear notifications:", err));
  }, []);

  const saveSettings = useCallback(async (next: NotificationSettings) => {
    setSettings(next);
    try {
      const saved = await setNotificationSettings(next);
      setSettings(saved);
    } catch (err) {
      console.error("Failed to save notification settings:", err);
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  // Per-session unread counts for sidebar badges.
  const sessionUnread: Record<string, number> = {};
  for (const n of notifications) {
    if (!n.readAt) {
      sessionUnread[n.sessionId] = (sessionUnread[n.sessionId] || 0) + 1;
    }
  }

  return {
    notifications,
    unreadCount,
    settings,
    loading,
    sessionUnread,
    reload,
    reloadSettings,
    markRead,
    markAllRead,
    clearAll,
    saveSettings,
  };
}

/**
 * Tracks the currently-viewed session id and POSTs it to the server (debounced)
 * so the ExcludeActiveView notification setting can suppress alerts for the
 * session the user is already looking at.
 */
export function useActiveView(activeSessionId: string | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotificationActiveView(activeSessionId).catch(() => {
        // Non-critical; ignore.
      });
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activeSessionId]);
}
