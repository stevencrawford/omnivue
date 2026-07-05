import { useEffect, useLayoutEffect, useRef } from "react";

interface SSECallbacks {
  onUpdate: () => void;
  onSessionChanged?: (sessionIds: string[]) => void;
  onNotification?: () => void;
  onNotificationsRead?: (ids: string[] | null) => void;
  onStarted?: () => void;
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
            console.debug("[SSE] server pid changed, reloading", data.pid);
            window.location.reload();
            return;
          }
          serverPid = data.pid;
        } catch {
          // ignore
        }
        console.debug("[SSE] started event, pid=", serverPid);
        callbacksRef.current.onStarted?.();
      });

      es.addEventListener("update", () => {
        console.debug("[SSE] update event");
        callbacksRef.current.onUpdate();
      });

      es.addEventListener("reset", () => {
        console.debug("[SSE] reset event, reloading");
        window.location.reload();
      });

      es.addEventListener("session-changed", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data.ids)) {
            console.debug("[SSE] session-changed event", data.ids);
            callbacksRef.current.onSessionChanged?.(data.ids);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("notification", () => {
        console.debug("[SSE] notification event");
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
