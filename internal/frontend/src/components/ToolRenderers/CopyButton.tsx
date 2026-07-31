import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";

type CopyMode = "input" | "output";

const COPY_MODE_KEY = "omnivue-copy-mode-";

function readStoredMode(kind: string | undefined, fallback: CopyMode): CopyMode {
  if (!kind) return fallback;
  try {
    const stored = localStorage.getItem(COPY_MODE_KEY + kind);
    if (stored === "input" || stored === "output") return stored;
  } catch {
    /* ignore */
  }
  return fallback;
}

function CopyButton({
  outputText,
  inputText,
  kind,
  defaultMode = "output",
}: {
  /** Text to copy when the selected mode is "output". */
  outputText: string;
  /** Text to copy when the selected mode is "input". When omitted or empty, no toggle is shown. */
  inputText?: string;
  /** Kind used to persist the user's selected mode in localStorage. */
  kind?: string;
  /** Default mode when nothing is stored for the kind. */
  defaultMode?: CopyMode;
}) {
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<CopyMode>(() => readStoredMode(kind, defaultMode));
  const menuRef = useRef<HTMLDivElement>(null);

  const hasToggle = inputText !== undefined && inputText !== "";
  const effectiveMode: CopyMode = hasToggle ? mode : "output";

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [menuOpen]);

  const doCopy = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const text = effectiveMode === "input" && inputText ? inputText : outputText;
    navigator.clipboard.writeText(text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectMode = (m: CopyMode) => {
    setMode(m);
    setMenuOpen(false);
    if (kind) {
      try {
        localStorage.setItem(COPY_MODE_KEY + kind, m);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={doCopy}
          className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
          title={effectiveMode === "input" ? "Copy input" : "Copy output"}
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        {hasToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            title="Copy input or output"
          >
            <ChevronDown size={11} />
          </button>
        )}
      </div>
      {hasToggle && menuOpen && (
        <div className="absolute right-0 top-full z-[100] min-w-[130px] bg-surface-elevated border border-ov-border rounded-lg shadow-xl py-1">
          <button
            type="button"
            onClick={() => selectMode("input")}
            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-ov-bg-hover ${
              mode === "input" ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"
            }`}
          >
            Copy input
          </button>
          <button
            type="button"
            onClick={() => selectMode("output")}
            className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-ov-bg-hover ${
              mode === "output" ? "text-accent" : "text-ov-text-secondary hover:text-ov-text"
            }`}
          >
            Copy output
          </button>
        </div>
      )}
    </div>
  );
}

export default CopyButton;
