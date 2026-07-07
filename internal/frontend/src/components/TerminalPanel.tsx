import { useCallback, useEffect, useRef, useState } from "react";
import { X, Terminal } from "lucide-react";
import { useTerminal, type TerminalStatus } from "../hooks/useTerminal";

interface TerminalPanelProps {
  sessionId: string;
  onClose: () => void;
}

const TERM_WIDTH_KEY = "omnivue-term-width";
const MIN_WIDTH = 250;
const MAX_WIDTH = 800;

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(TERM_WIDTH_KEY);
    if (stored) return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(stored)));
  } catch {
    /* noop */
  }
  return 400;
}

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<any>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const [xtermLoaded, setXtermLoaded] = useState(false);
  const [status, setStatus] = useState<TerminalStatus>("disconnected");
  const [width, setWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);

  const { connect, disconnect, send } = useTerminal({
    sessionId,
    onOutput: useCallback((data: string) => {
      terminalInstance.current?.write(data);
    }, []),
    onStatusChange: useCallback((s: TerminalStatus) => {
      setStatus(s);
    }, []),
  });

  const themeTerminal = useCallback(() => {
    const term = terminalInstance.current;
    if (!term) return;
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const bg = style.getPropertyValue("--color-ov-bg").trim() || "#0b0e14";
    const fg = style.getPropertyValue("--color-ov-text").trim() || "#bfbdb6";
    const accent = style.getPropertyValue("--color-accent").trim() || "#ffad66";
    term.options.theme = {
      background: bg,
      foreground: fg,
      cursor: accent,
      selectionBackground: accent + "40",
      black: "#1a1a2e",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#d19a66",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#d19a66",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let term: any = null;
    let fitAddon: { fit: () => void } | null = null;

    async function loadXterm() {
      const [xtermMod, fitMod] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (cancelled || !termRef.current) return;

      const { Terminal: XtermTerminal } = xtermMod;
      const { FitAddon } = fitMod;

      const root = document.documentElement;
      const style = getComputedStyle(root);
      const bg = style.getPropertyValue("--color-ov-bg").trim() || "#0b0e14";
      const fg = style.getPropertyValue("--color-ov-text").trim() || "#bfbdb6";
      const accent = style.getPropertyValue("--color-accent").trim() || "#ffad66";

      term = new XtermTerminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace",
        allowTransparency: true,
        theme: {
          background: bg,
          foreground: fg,
          cursor: accent,
          selectionBackground: accent + "40",
          black: "#1a1a2e",
          red: "#e06c75",
          green: "#98c379",
          yellow: "#d19a66",
          blue: "#61afef",
          magenta: "#c678dd",
          cyan: "#56b6c2",
          white: "#abb2bf",
          brightBlack: "#5c6370",
          brightRed: "#e06c75",
          brightGreen: "#98c379",
          brightYellow: "#d19a66",
          brightBlue: "#61afef",
          brightMagenta: "#c678dd",
          brightCyan: "#56b6c2",
          brightWhite: "#ffffff",
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current);
      fitAddon.fit();

      term.onData((data: string) => {
        send(data);
      });

      terminalInstance.current = term;
      fitAddonRef.current = fitAddon;
      setXtermLoaded(true);
      connect();
    }

    loadXterm();

    return () => {
      cancelled = true;
      disconnect();
      term?.dispose();
      terminalInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, connect, disconnect, send]);

  useEffect(() => {
    themeTerminal();
  }, [status, themeTerminal]);

  useEffect(() => {
    const onResize = () => fitAddonRef.current?.fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth - (ev.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      resizeListeners.current = [];
      const finalWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth - (ev.clientX - startX)));
      try {
        localStorage.setItem(TERM_WIDTH_KEY, String(finalWidth));
      } catch {
        /* noop */
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  };

  const statusColor =
    status === "connected"
      ? "text-green-500"
      : status === "connecting"
        ? "text-yellow-500"
        : "text-ov-text-secondary";

  return (
    <aside className="flex shrink-0 relative" style={{ width: `${width}px` }}>
      <div
        className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-accent/40 transition-colors z-10 ${isResizing ? "bg-accent/50" : ""}`}
        onMouseDown={handleMouseDown}
      />
      <div className="flex-1 flex flex-col overflow-hidden bg-ov-bg border-l border-ov-border">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-ov-border shrink-0">
          <div className="flex items-center gap-2 text-xs text-ov-text-secondary">
            <Terminal size={12} />
            <span>Terminal</span>
            <span className={`inline-flex items-center gap-1 ${statusColor}`}>
              <span className="size-1.5 rounded-full bg-current" />
              {status}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          >
            <X size={12} />
          </button>
        </div>
        <div className="flex-1 min-h-0 relative">
          {!xtermLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-ov-text-secondary">
              Loading terminal...
            </div>
          )}
          <div
            ref={termRef}
            className={`absolute inset-0 ${xtermLoaded ? "" : "hidden"}`}
          />
        </div>
      </div>
    </aside>
  );
}
