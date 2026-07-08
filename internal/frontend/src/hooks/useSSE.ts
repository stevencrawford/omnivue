import { useEffect, useRef } from "react";
import { Stream, Effect, Schedule } from "effect";
import { runFork } from "../lib/effect";

interface SSECallbacks {
  onUpdate: () => void;
  onSessionChanged?: (sessionIds: string[]) => void;
  onNotification?: () => void;
  onNotificationsRead?: (ids: string[] | null) => void;
  onStarted?: () => void;
}

type SSEEvent =
  | { type: "update" }
  | { type: "session-changed"; ids: string[] }
  | { type: "notification" }
  | { type: "notifications-read"; ids: string[] | null }
  | { type: "started"; pid: number }
  | { type: "reset" };

function makeSSEStream() {
  return Stream.async<SSEEvent, string>((emit) => {
    const es = new EventSource("/_/events");

    es.addEventListener("started", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (typeof data.pid === "number") {
          emit.single({ type: "started", pid: data.pid });
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("update", () => {
      emit.single({ type: "update" });
    });

    es.addEventListener("reset", () => {
      emit.single({ type: "reset" });
    });

    es.addEventListener("session-changed", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (Array.isArray(data.ids)) {
          emit.single({ type: "session-changed", ids: data.ids });
        }
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("notification", () => {
      emit.single({ type: "notification" });
    });

    es.addEventListener("notifications-read", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (data && data.all) {
          emit.single({ type: "notifications-read", ids: null });
        } else if (Array.isArray(data.ids)) {
          emit.single({ type: "notifications-read", ids: data.ids });
        } else {
          emit.single({ type: "notifications-read", ids: null });
        }
      } catch {
        emit.single({ type: "notifications-read", ids: null });
      }
    });

    es.onerror = () => {
      emit.fail("connection_error");
    };

    return Effect.sync(() => es.close());
  }).pipe(
    Stream.retry(
      Schedule.exponential("1 seconds").pipe(
        Schedule.whileInput((_e: string) => true),
        Schedule.upTo("60 seconds"),
      ),
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
