import { useEffect, useRef, useState } from "react";
import type { Session } from "../hooks/useApi";
import { setSessionName, clearSessionName } from "../hooks/useApi";

export function SessionHeader({ session }: { session: Session }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [displayTitle, setDisplayTitle] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayTitle(session.title);
  }, [session.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setEditValue(displayTitle);
    setEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      try {
        await setSessionName(session.id, trimmed);
        setDisplayTitle(trimmed);
      } catch {
        /* ignore */
      }
    }
    setEditing(false);
  };

  const clearOverride = async () => {
    try {
      await clearSessionName(session.id);
      setDisplayTitle(session.title);
    } catch {
      /* ignore */
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") setEditing(false);
  };

  const badgeClass =
    session.agent === "opencode"
      ? "sess-agent-badge sess-agent-badge--opencode"
      : session.agent === "copilot"
        ? "sess-agent-badge sess-agent-badge--copilot"
        : "sess-agent-badge bg-gh-bg-hover text-gh-text-secondary";

  return (
    <div className="px-4 py-3 border-b border-gh-border shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveEdit}
              className="flex-1 text-sm font-semibold bg-gh-bg-secondary border border-accent-border rounded px-1.5 py-0.5 text-gh-text outline-none min-w-0"
            />
            <button
              type="button"
              onClick={clearOverride}
              className="text-[11px] text-gh-text-secondary hover:text-gh-text cursor-pointer shrink-0 px-1"
              title="Revert to original name"
            >
              Reset
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gh-text truncate">
              {displayTitle || session.id}
            </h2>
            {!session.parentId && (
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 text-gh-text-secondary hover:text-accent cursor-pointer p-0.5 rounded transition-colors"
                title="Rename session"
              >
                <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.745 8.815a.25.25 0 0 0-.063.109l-.579 2.027 2.027-.579a.25.25 0 0 0 .109-.063l8.273-8.273a.25.25 0 0 0 0-.354l-1.086-1.086Z" />
                </svg>
              </button>
            )}
          </>
        )}
        <span className={`${badgeClass} shrink-0`}>{session.agent}</span>
        <span
          className="text-[11px] font-mono text-gh-text-secondary ml-auto truncate max-w-[40%]"
          title={session.directory}
        >
          {session.repository || session.directory}
        </span>
      </div>
    </div>
  );
}
