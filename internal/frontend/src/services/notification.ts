import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { AppNotification, NotificationSettings } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class NotificationService extends Effect.Service<NotificationService>()(
  "NotificationService",
  {
    effect: Effect.gen(function* () {
      const list = (
        opts: { limit?: number; unreadOnly?: boolean } = {},
      ): Effect.Effect<AppNotification[], ApiError> =>
        Effect.tryPromise({
          try: () => api.fetchNotifications(opts),
          catch: catchToApiError("/_/api/notifications"),
        });

      const markRead = (ids: string[] | null): Effect.Effect<void, ApiError> =>
        Effect.tryPromise({
          try: () => api.markNotificationsRead(ids),
          catch: catchToApiError("/_/api/notifications/read"),
        });

      const clearAll = (): Effect.Effect<void, ApiError> =>
        Effect.tryPromise({
          try: () => api.clearNotifications(),
          catch: catchToApiError("/_/api/notifications"),
        });

      const setActiveView = (sessionId: string): Effect.Effect<void, ApiError> =>
        Effect.tryPromise({
          try: () => api.setNotificationActiveView(sessionId),
          catch: catchToApiError("/_/api/notifications/active-view"),
        });

      const getSettings = (): Effect.Effect<NotificationSettings, ApiError> =>
        Effect.tryPromise({
          try: () => api.fetchNotificationSettings(),
          catch: catchToApiError("/_/api/notifications/settings"),
        });

      const saveSettings = (
        settings: NotificationSettings,
      ): Effect.Effect<NotificationSettings, ApiError> =>
        Effect.tryPromise({
          try: () => api.setNotificationSettings(settings),
          catch: catchToApiError("/_/api/notifications/settings"),
        });

      return { list, markRead, clearAll, setActiveView, getSettings, saveSettings } as const;
    }),
  },
) {}
