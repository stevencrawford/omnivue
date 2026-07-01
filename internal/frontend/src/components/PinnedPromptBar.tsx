import { useState, useEffect, useRef } from "react";
import { ChevronRight, User, Check, Copy } from "lucide-react";
import type { Session, Message } from "../hooks/useApi";
import { fetchResumeCommand } from "../hooks/useApi";
import { formatCost, formatTokenBreakdown } from "../utils/sessionUtils";
import { UserPromptBubble } from "./UserPromptBubble";

export function PinnedPromptBar({
  session,
  firstMessage,
  onOpenModal,
}: {
  session: Session;
  firstMessage: Message;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [pinnedExpanded, setPinnedExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pinnedHeight, setPinnedHeight] = useState(() => {
    try {
      const stored = localStorage.getItem("omnivue-pinned-height");
      if (stored) return Math.max(60, Math.min(600, Number(stored)));
    } catch {
      // localStorage may be unavailable
    }
    return 260;
  });
  const [isPinnedResizing, setIsPinnedResizing] = useState(false);
  const totalTokens =
    session.tokensInput + session.tokensOutput + session.tokensCacheRead + session.tokensCacheWrite;
  const resizeListeners = useRef<Array<[string, EventListenerOrEventListenerObject]>>([]);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      for (const [type, handler] of resizeListeners.current) {
        document.removeEventListener(type, handler);
      }
      resizeListeners.current = [];
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleResume = async () => {
    try {
      const cmd = await fetchResumeCommand(session.id);
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handlePinnedResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    for (const [type, handler] of resizeListeners.current) {
      document.removeEventListener(type, handler);
    }
    resizeListeners.current = [];
    setIsPinnedResizing(true);
    const startY = e.clientY;
    const startHeight = pinnedHeight;

    const handleMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(60, Math.min(600, startHeight + (startY - ev.clientY)));
      setPinnedHeight(newHeight);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      setIsPinnedResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      resizeListeners.current = [];
      const finalHeight = Math.max(60, Math.min(600, startHeight + (startY - ev.clientY)));
      try {
        localStorage.setItem("omnivue-pinned-height", String(finalHeight));
      } catch {
        // localStorage may be unavailable
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    resizeListeners.current = [
      ["mousemove", handleMouseMove as EventListener],
      ["mouseup", handleMouseUp as EventListener],
    ];
  };

  function showCosts(): boolean {
    try {
      return localStorage.getItem("omnivue-show-costs") !== "false";
    } catch {
      return true;
    }
  }

  return (
    <>
      <div
        className={`shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-accent/30 transition-colors ${
          isPinnedResizing ? "bg-accent/40" : ""
        }`}
        onMouseDown={handlePinnedResizeStart}
      >
        <div className="w-6 h-0.5 rounded-full bg-ov-border" />
      </div>

      <div
        className="sess-pinned-bar shrink-0 overflow-hidden"
        style={pinnedExpanded ? { maxHeight: pinnedHeight } : undefined}
      >
        <button
          type="button"
          className="flex items-center gap-2 w-full px-4 py-2 text-left cursor-pointer hover:bg-ov-bg-hover transition-colors"
          onClick={() => setPinnedExpanded((v) => !v)}
        >
          <ChevronRight
            size={12}
            className={`text-ov-text-secondary transition-transform ${pinnedExpanded ? "rotate-90" : ""}`}
          />
          <User size={16} className="text-accent-secondary shrink-0" />
          <span className="text-xs font-semibold text-ov-text">Initial Prompt</span>
          {session.model && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-ov-bg-hover text-ov-text-secondary font-mono">
              {session.model}
            </span>
          )}

          {totalTokens > 0 && (
            <span
              className="text-[11px] text-ov-text-secondary"
              title={`${session.tokensInput.toLocaleString()} in / ${session.tokensCacheRead.toLocaleString()} cached / ${session.tokensOutput.toLocaleString()} out`}
            >
              {formatTokenBreakdown(session)}
            </span>
          )}
          {session.cost > 0 && showCosts() && (
            <span className="text-[11px] text-ov-text-secondary" title="Cost">
              {formatCost(session.cost)}
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleResume();
            }}
            className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border cursor-pointer transition-all ml-auto shrink-0 ${
              copied
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-accent-border bg-accent-muted text-accent hover:shadow-[0_0_12px_var(--color-glow)]"
            }`}
            title="Copy resume command"
          >
            {copied ? (
              <>
                <Check size={10} className="text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy size={10} />
                Resume
              </>
            )}
          </button>
        </button>
        {pinnedExpanded && (
          <div className="px-4 pb-3 overflow-y-auto border-t border-ov-border">
            <div className="ml-6 mt-2">
              <UserPromptBubble message={firstMessage} onOpenModal={onOpenModal} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
