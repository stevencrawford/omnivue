import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { Session } from "../hooks/useApi";
import { setSessionName, clearSessionName } from "../hooks/useApi";
import { agentLabel } from "../utils/sessionUtils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SessionHeader({ session, hasPrivacy }: { session: Session; hasPrivacy?: boolean }) {
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

  const badgeClass = `sess-agent-badge sess-agent-badge--${session.agent}`;

  return (
    <div className="px-4 py-3 border-b border-ov-border shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {editing ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveEdit}
              className="flex-1 h-auto text-sm font-semibold px-1.5 py-0.5 border-accent-border"
            />
            <Button
              variant="ghost"
              size="xs"
              onClick={clearOverride}
              title="Revert to original name"
            >
              Reset
            </Button>
          </div>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-ov-text truncate">
              {displayTitle || session.id}
            </h2>
            {!session.parentId && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={startEdit}
                className="text-ov-text-secondary hover:text-accent"
                title="Rename session"
              >
                <Pencil />
              </Button>
            )}
          </>
        )}
        <span className={`${badgeClass} shrink-0`}>{agentLabel(session.agent)}</span>
        {hasPrivacy && <span className="sess-privacy-badge shrink-0">Privacy mode</span>}
        <span
          className="text-[11px] font-mono text-ov-text-secondary ml-auto truncate max-w-[40%]"
          title={session.directory}
        >
          {session.repository || session.directory}
        </span>
      </div>
    </div>
  );
}
