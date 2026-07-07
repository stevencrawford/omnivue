import { useCallback, useEffect, useRef, useState } from "react";

export type TerminalStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseTerminalOptions {
  sessionId: string;
  onOutput?: (data: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
}

interface UseTerminalReturn {
  status: TerminalStatus;
  connect: () => void;
  disconnect: () => void;
  send: (data: string) => void;
  resize: (cols: number, rows: number) => void;
}

export function useTerminal({
  sessionId,
  onOutput,
  onStatusChange,
}: UseTerminalOptions): UseTerminalReturn {
  const [status, setStatus] = useState<TerminalStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(1000);
  const disposedRef = useRef(false);
  const onOutputRef = useRef(onOutput);
  const onStatusChangeRef = useRef(onStatusChange);
  const statusRef = useRef(status);

  onOutputRef.current = onOutput;
  onStatusChangeRef.current = onStatusChange;
  statusRef.current = status;

  const setStatusSafe = useCallback((s: TerminalStatus) => {
    setStatus(s);
    onStatusChangeRef.current?.(s);
  }, []);

  const disconnect = useCallback(() => {
    disposedRef.current = true;
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    if (statusRef.current !== "disconnected") {
      setStatusSafe("disconnected");
    }
  }, [setStatusSafe]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    disposedRef.current = false;
    retryDelayRef.current = 1000;
    setStatusSafe("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/_/ws/terminal?session_id=${encodeURIComponent(sessionId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current) {
        ws.close();
        return;
      }
      retryDelayRef.current = 1000;
      setStatusSafe("connected");
    };

    ws.onmessage = (event) => {
      if (disposedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          onOutputRef.current?.(msg.data);
        } else if (msg.type === "status") {
          if (msg.data === "disconnected") {
            setStatusSafe("disconnected");
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (disposedRef.current) return;
      setStatusSafe("disconnected");
      retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
      retryRef.current = setTimeout(() => {
        if (!disposedRef.current) connect();
      }, retryDelayRef.current);
    };

    ws.onerror = (event) => {
      console.error("useTerminal ws error event:", event.type);
    };
  }, [sessionId, setStatusSafe]);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", data: { cols, rows } }));
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { status, connect, disconnect, send, resize };
}
