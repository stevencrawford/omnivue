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
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const [xtermLoaded, setXtermLoaded] = useState(false);

  const { connect, disconnect, send } = useTerminal({
    sessionId,
    onOutput: useCallback((data: string) => {
      terminalInstance.current?.write(data);
    }, []),
  });

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
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(termRef.current);

      // Defer fit to next frame so layout is settled
      requestAnimationFrame(() => {
        fitAddon?.fit();
      });

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
    const ro = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full relative">
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
  );
}
