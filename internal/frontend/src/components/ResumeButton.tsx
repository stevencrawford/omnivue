import { ListRestart, Check, FolderOpen, Terminal, MessageSquareCode } from "lucide-react";
import { useCopy } from "../hooks/useCopy";
import { fetchResumeCommand } from "../hooks/apiClient";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

function middleTruncate(s: string, max = 60): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 3) / 2);
  return s.slice(0, half) + "..." + s.slice(s.length - (max - 3 - half));
}

function OptionPreview({
  label,
  cmd,
  icon,
}: {
  label: string;
  cmd: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 group cursor-pointer transition-colors hover:bg-ov-bg-hover">
      <span className="size-3.5 flex items-center justify-center shrink-0 mt-0.5 text-ov-text-secondary group-hover:text-ov-text">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ov-text-secondary group-hover:text-ov-text">{label}</div>
        <div
          className="text-[11px] text-ov-text-secondary/60 group-hover:text-ov-text-secondary/80 font-mono truncate"
          title={cmd}
        >
          {middleTruncate(cmd)}
        </div>
      </div>
    </div>
  );
}

export function ResumeButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [options, setOptions] = useState<{
    absolute: string;
    relative: string;
    agentCommand: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy(2000);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRectRef = useRef<{ top: number; right: number; bottom: number } | null>(null);
  const appliedPosRef = useRef<{ x: number; y: number } | null>(null);

  // Keep the popup fully on screen: flip above the trigger when it would
  // overflow the bottom, and clamp horizontally within the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRectRef.current;
    if (!menu || !trigger) return;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const gap = 6;
    let x = trigger.right;
    let y = trigger.bottom + gap;
    if (y + mh > window.innerHeight - gap) {
      y = trigger.top - gap - mh;
    }
    // With translateX(-100%), x is the popup's right edge: [x - mw, x].
    x = Math.min(Math.max(x, gap + mw), window.innerWidth - gap);
    y = Math.min(Math.max(y, gap), window.innerHeight - gap - mh);
    const next = { x: Math.round(x), y: Math.round(y) };
    const applied = appliedPosRef.current;
    if (!applied || applied.x !== next.x || applied.y !== next.y) {
      appliedPosRef.current = next;
      setMenuPos(next);
    }
  }, [open, options, loading]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        wrapperRef.current &&
        !wrapperRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const handleClick = async () => {
    setOpen((prev) => {
      if (!prev && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        triggerRectRef.current = { top: rect.top, right: rect.right, bottom: rect.bottom };
      }
      return !prev;
    });
    if (!options && !loading) {
      setLoading(true);
      try {
        const cmd = await fetchResumeCommand(sessionId);
        setOptions(cmd);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        className="size-7 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
        title="Copy resume command"
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <ListRestart size={12} />}
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[220px] max-w-[340px] bg-surface-elevated border border-ov-border rounded-lg shadow-xl py-1"
          style={{ left: menuPos.x, top: menuPos.y, transform: "translateX(-100%)" }}
        >
          {loading ? (
            <div className="px-3 py-2 text-xs text-ov-text-secondary">Loading...</div>
          ) : options ? (
            <>
              <button
                type="button"
                className="w-full text-left group"
                title={options.absolute}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.absolute);
                  setOpen(false);
                }}
              >
                <OptionPreview
                  label="Absolute"
                  cmd={options.absolute}
                  icon={<FolderOpen size={12} />}
                />
              </button>
              <button
                type="button"
                className="w-full text-left group"
                title={options.relative}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.relative);
                  setOpen(false);
                }}
              >
                <OptionPreview label="Agent" cmd={options.relative} icon={<Terminal size={12} />} />
              </button>
              <button
                type="button"
                className="w-full text-left group"
                title={options.agentCommand}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.agentCommand);
                  setOpen(false);
                }}
              >
                <OptionPreview
                  label="Command"
                  cmd={options.agentCommand}
                  icon={<MessageSquareCode size={12} />}
                />
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
