import { useEffect, useRef } from "react";
import { Stream, Effect, Queue } from "effect";
import { runFork } from "../lib/effect";

interface SSECallbacks {
  onUpdate: () => void;
  onSessionChanged?: (sessionIds: string[]) => void;
  onNotification?: () => void;
  onNotificationsRead?: (ids: string[] | null) => void;
  onPromptQueueChanged?: () => void;
  onStarted?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

type SSEEvent =
  | { type: "update" }
  | { type: "session-changed"; ids: string[] }
  | { type: "notification" }
  | { type: "notifications-read"; ids: string[] | null }
  | { type: "prompt-queue-changed" }
  | { type: "started"; pid: number }
  | { type: "connection"; connected: boolean }
  | { type: "reset" };

function makeSSEStream() {
  return Stream.callback<SSEEvent, never>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const es = new EventSource("/_/events");

        es.addEventListener("started", (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data);
            if (typeof data.pid === "number") {
              Queue.offerUnsafe(queue, { type: "started", pid: data.pid });
            }
          } catch {
            /* ignore */
          }
        });

        es.addEventListener("update", () => {
          Queue.offerUnsafe(queue, { type: "update" });
        });

        es.addEventListener("reset", () => {
          Queue.offerUnsafe(queue, { type: "reset" });
        });

        es.addEventListener("session-changed", (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data);
            if (Array.isArray(data.ids)) {
              Queue.offerUnsafe(queue, { type: "session-changed", ids: data.ids });
            }
          } catch {
            /* ignore */
          }
        });

        es.addEventListener("notification", () => {
          Queue.offerUnsafe(queue, { type: "notification" });
        });

        es.addEventListener("prompt-queue-changed", () => {
          Queue.offerUnsafe(queue, { type: "prompt-queue-changed" });
        });

        es.addEventListener("notifications-read", (e) => {
          try {
            const data = JSON.parse((e as MessageEvent).data);
            if (data && data.all) {
              Queue.offerUnsafe(queue, { type: "notifications-read", ids: null });
            } else if (Array.isArray(data.ids)) {
              Queue.offerUnsafe(queue, { type: "notifications-read", ids: data.ids });
            } else {
              Queue.offerUnsafe(queue, { type: "notifications-read", ids: null });
            }
          } catch {
            Queue.offerUnsafe(queue, { type: "notifications-read", ids: null });
          }
        });

        es.onopen = () => {
          Queue.offerUnsafe(queue, { type: "connection", connected: true });
        };

        es.onerror = () => {
          // Let the browser's native EventSource reconnect instead of failing the
          // stream: failing the queue would feed a retry schedule that could end
          // permanently, leaving the app with no SSE after a sustained blip.
          Queue.offerUnsafe(queue, { type: "connection", connected: false });
        };

        return es;
      }),
      (es) => Effect.sync(() => es.close()),
    ),
  );
}

export function useSSE(callbacks: SSECallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let serverPid: number | null = null;

    const cancel = runFork(
      makeSSEStream().pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            const cb = callbacksRef.current;

            switch (event.type) {
              case "update":
                cb.onUpdate();
                break;
              case "session-changed":
                if (event.ids.length > 0) {
                  cb.onSessionChanged?.(event.ids);
                }
                break;
              case "notification":
                cb.onNotification?.();
                break;
              case "prompt-queue-changed":
                cb.onPromptQueueChanged?.();
                break;
              case "notifications-read":
                cb.onNotificationsRead?.(event.ids);
                break;
              case "started":
                if (serverPid !== null && event.pid !== serverPid) {
                  window.location.reload();
                  return;
                }
                serverPid = event.pid;
                cb.onStarted?.();
                break;
              case "connection":
                cb.onConnectionChange?.(event.connected);
                break;
              case "reset":
                window.location.reload();
                break;
            }
          }),
        ),
      ),
    );

    return cancel;
  }, []);
}
