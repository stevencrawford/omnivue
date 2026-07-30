import { ListRestart, Check, FolderOpen, Terminal, MessageSquareCode } from "lucide-react";
import { useCopy } from "../hooks/useCopy";
import { fetchResumeCommand } from "../hooks/useApi";
import { useEffect, useRef, useState } from "react";

export function ResumeButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{
    absolute: string;
    relative: string;
    agentCommand: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopy(2000);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
    setOpen((prev) => !prev);
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
    <div ref={ref} className="relative">
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
        <div className="absolute right-0 top-full mt-1 z-[100] min-w-[220px] bg-surface-elevated border border-ov-border rounded-lg shadow-xl py-1">
          {loading ? (
            <div className="px-3 py-2 text-xs text-ov-text-secondary">Loading...</div>
          ) : options ? (
            <>
              <button
                type="button"
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                title={options.absolute}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.absolute);
                  setOpen(false);
                }}
              >
                <FolderOpen size={12} className="shrink-0" />
                <span className="truncate">Absolute</span>
              </button>
              <button
                type="button"
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                title={options.relative}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.relative);
                  setOpen(false);
                }}
              >
                <Terminal size={12} className="shrink-0" />
                <span className="truncate">Relative</span>
              </button>
              <button
                type="button"
                className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                title={options.agentCommand}
                onClick={(e) => {
                  e.stopPropagation();
                  copy(options.agentCommand);
                  setOpen(false);
                }}
              >
                <MessageSquareCode size={12} className="shrink-0" />
                <span className="truncate">Agent command</span>
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
