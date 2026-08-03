import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification, NotificationSettings } from "./types";
import { useSSE } from "./useSSE";
import {
  fetchNotifications,
  markNotificationsRead,
  clearNotifications,
  setNotificationActiveView,
  fetchNotificationSettings,
  setNotificationSettings,
} from "./apiClient";

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
    setLoading(true);
    fetchNotifications({ limit: 100 })
      .then((data) => {
        setNotifications(data || []);
      })
      .catch((err: unknown) => {
        console.error("[notifications] reload failed:", err instanceof Error ? err.message : err);
      })
      .finally(() => setLoading(false));
  }, []);

  const reloadSettings = useCallback(async () => {
    try {
      const s = await fetchNotificationSettings();
      setSettings(s);
    } catch (err) {
      console.error(
        "[notifications] failed to load settings:",
        err instanceof Error ? err.message : err,
      );
      setSettings(null);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => reload(), 300);
  }, [reload]);

  useEffect(() => {
    reload();
    reloadSettings();
  }, [reload, reloadSettings]);

  useEffect(() => {
    const id = setInterval(() => reload(), 60000);
    const timer = reloadTimer;
    return () => {
      clearInterval(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
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
    markNotificationsRead(ids).catch((err: unknown) =>
      console.error("Failed to mark read:", err instanceof Error ? err.message : err),
    );
  }, []);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: now })));
    markNotificationsRead(null).catch((err: unknown) =>
      console.error("Failed to mark all read:", err instanceof Error ? err.message : err),
    );
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    clearNotifications().catch((err: unknown) =>
      console.error("Failed to clear notifications:", err instanceof Error ? err.message : err),
    );
  }, []);

  const saveSettings = useCallback(async (next: NotificationSettings) => {
    setSettings(next);
    try {
      const saved = await setNotificationSettings(next);
      setSettings(saved);
    } catch (err) {
      console.error(
        "[notifications] failed to save settings:",
        err instanceof Error ? err.message : err,
      );
      setSettings(next);
    }
  }, []);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

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

export function useActiveView(activeSessionId: string | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const report = useCallback((sessionId: string) => {
    setNotificationActiveView(sessionId).catch(() => {
      /* ignore */
    });
  }, []);
  useEffect(() => {
    if (!activeSessionId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => report(activeSessionId), 500);
    // Heartbeat: keep the session marked as active so the server-side
    // ExcludeActiveView window doesn't expire while the user stays on it.
    interval.current = setInterval(() => report(activeSessionId), 60_000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (interval.current) clearInterval(interval.current);
    };
  }, [activeSessionId, report]);
}
