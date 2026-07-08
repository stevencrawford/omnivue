import { useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { AppNotification, NotificationSettings } from "./types";
import { useSSE } from "./useSSE";
import { NotificationService, ApiError } from "../services";
import { runPromise } from "../lib/effect";

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

function fetchNotificationsEffect(opts: { limit?: number; unreadOnly?: boolean } = {}) {
  return NotificationService.pipe(
    Effect.flatMap((svc) => svc.list(opts)),
    Effect.catchAll((err: ApiError) => {
      console.error("[notifications] reload failed:", err.message);
      return Effect.succeed([] as AppNotification[]);
    }),
  );
}

function markReadEffect(ids: string[]) {
  return NotificationService.pipe(
    Effect.flatMap((svc) => svc.markRead(ids)),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to mark read:", err.message)),
    ),
  );
}

function markAllReadEffect() {
  return NotificationService.pipe(
    Effect.flatMap((svc) => svc.markRead(null)),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to mark all read:", err.message)),
    ),
  );
}

function clearAllEffect() {
  return NotificationService.pipe(
    Effect.flatMap((svc) => svc.clearAll()),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to clear notifications:", err.message)),
    ),
  );
}

export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    runPromise(fetchNotificationsEffect({ limit: 100 }))
      .then((data) => {
        setNotifications(data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const reloadSettings = useCallback(async () => {
    const s = await runPromise(
      NotificationService.pipe(
        Effect.flatMap((svc) => svc.getSettings()),
        Effect.catchAll((err: ApiError) => {
          console.error("[notifications] failed to load settings:", err.message);
          return Effect.succeed(null as unknown as NotificationSettings);
        }),
      ),
    );
    setSettings(s);
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
    runPromise(markReadEffect(ids));
  }, []);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: now })));
    runPromise(markAllReadEffect());
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    runPromise(clearAllEffect());
  }, []);

  const saveSettings = useCallback(async (next: NotificationSettings) => {
    setSettings(next);
    const saved = await runPromise(
      NotificationService.pipe(
        Effect.flatMap((svc) => svc.saveSettings(next)),
        Effect.catchAll((err: ApiError) => {
          console.error("[notifications] failed to save settings:", err.message);
          return Effect.succeed(next);
        }),
      ),
    );
    setSettings(saved);
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
  useEffect(() => {
    if (!activeSessionId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      runPromise(
        NotificationService.pipe(
          Effect.flatMap((svc) => svc.setActiveView(activeSessionId)),
          Effect.catchAll(() => Effect.void),
        ),
      );
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [activeSessionId]);
}
