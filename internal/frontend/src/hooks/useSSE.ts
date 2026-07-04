import { useEffect, useLayoutEffect, useRef } from "react";

interface SSECallbacks {
  onUpdate: () => void;
  onSessionChanged?: (sessionIds: string[]) => void;
  onNotification?: () => void;
  onNotificationsRead?: (ids: string[] | null) => void;
}

export function useSSE(callbacks: SSECallbacks) {
  const callbacksRef = useRef(callbacks);
  useLayoutEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    let disposed = false;
    let es: EventSource | null = null;
    let retryDelay = 1000;
    const maxRetryDelay = 30000;
    let serverPid: number | null = null;

    function connect() {
      if (disposed) return;

      es = new EventSource("/_/events");

      es.addEventListener("started", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.pid !== "number") return;
          if (serverPid !== null && data.pid !== serverPid) {
            window.location.reload();
            return;
          }
          serverPid = data.pid;
        } catch {
          // ignore
        }
      });

      es.addEventListener("update", () => {
        callbacksRef.current.onUpdate();
      });

      es.addEventListener("reset", () => {
        window.location.reload();
      });

      es.addEventListener("session-changed", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data.ids)) {
            callbacksRef.current.onSessionChanged?.(data.ids);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("notification", () => {
        callbacksRef.current.onNotification?.();
      });

      es.addEventListener("notifications-read", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.all) {
            callbacksRef.current.onNotificationsRead?.(null);
          } else if (Array.isArray(data.ids)) {
            callbacksRef.current.onNotificationsRead?.(data.ids);
          } else {
            callbacksRef.current.onNotificationsRead?.(null);
          }
        } catch {
          callbacksRef.current.onNotificationsRead?.(null);
        }
      });

      es.onopen = () => {
        retryDelay = 1000;
      };

      es.onerror = () => {
        es?.close();
        if (!disposed) {
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
    };
  }, []);
}
