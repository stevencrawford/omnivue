import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminal } from "../hooks/useTerminal";

interface TerminalPanelProps {
  sessionId: string;
}

function xtermTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const bg = style.getPropertyValue("--color-ov-bg").trim() || "#0b0e14";
  const fg = style.getPropertyValue("--color-ov-text").trim() || "#bfbdb6";
  const accent = style.getPropertyValue("--color-accent").trim() || "#ffad66";
  return {
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
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const [xtermLoaded, setXtermLoaded] = useState(false);

  const {
    status,
    connect,
    disconnect,
    send,
    resize: terminalResize,
  } = useTerminal({
    sessionId,
    onOutput: useCallback((data: string) => {
      terminalInstance.current?.write(data);
    }, []),
  });

  const doFit = useCallback(() => {
    requestAnimationFrame(() => {
      const term = terminalInstance.current;
      const fa = fitAddonRef.current;
      if (!term?.element || !fa?.proposeDimensions) return;
      const dims = fa.proposeDimensions();
      if (dims) {
        term.resize(dims.cols + 1, dims.rows + 1);
        terminalResize(dims.cols, dims.rows);
      }
    });
  }, [terminalResize]);

  useEffect(() => {
    let cancelled = false;
    let term: any = null;
    let fitAddon: { fit: () => void } | null = null;

    async function loadXterm() {
      const [xtermMod, fitMod] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/xterm/css/xterm.css"),
      ]);

      if (cancelled || !termRef.current) return;

      const { Terminal: XtermTerminal } = xtermMod;
      const { FitAddon } = fitMod;

      term = new XtermTerminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace",
        allowTransparency: true,
        theme: xtermTheme(),
        scrollback: 0,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current);

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

  // Inject CSS to force xterm elements to fill their container
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      .xterm { width: 100% !important; height: 100% !important; }
      .xterm-viewport { width: 100% !important; height: 100% !important; overflow-y: hidden !important; }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Fit after xterm loads — try multiple times with increasing delay
  // to handle lazy layout settling (especially on initial mount)
  useEffect(() => {
    if (!xtermLoaded) return;
    doFit();
    const t1 = setTimeout(doFit, 50);
    const t2 = setTimeout(doFit, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [xtermLoaded, doFit]);

  // Focus xterm when it loads so keystrokes go straight to the agent TUI
  useEffect(() => {
    if (!xtermLoaded || status !== "connected") return;
    const term = terminalInstance.current;
    if (term) term.focus();
  }, [xtermLoaded, status]);

  // Re-fit on reconnect: after Ctrl+C kills the agent the WS reconnects
  // spawning a fresh PTY at 24x80 — send the current container size.
  useEffect(() => {
    if (!xtermLoaded || status !== "connected") return;
    doFit();
  }, [status, xtermLoaded, doFit]);

  // Observe theme changes and apply to xterm
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => {
      if (terminalInstance.current) {
        terminalInstance.current.options.theme = xtermTheme();
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
    return () => mo.disconnect();
  }, []);

  // Fit whenever the container changes size (handles tab visibility, window resize)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => doFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [doFit]);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {!xtermLoaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ov-text-secondary">
          <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          Loading terminal...
        </div>
      )}
      <div ref={termRef} className={`absolute inset-0 ${xtermLoaded ? "" : "hidden"}`} />
      {xtermLoaded && status !== "connected" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-ov-text-secondary">
          <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          {status === "connecting" && "Connecting..."}
          {status === "disconnected" && "Reconnecting..."}
          {status === "error" && "Connection failed, retrying..."}
        </div>
      )}
    </div>
  );
}
