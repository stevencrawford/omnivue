import { useEffect, useRef, useState } from "react";
import type { Session } from "../../hooks/types";

interface AssignPickerProps {
  sessions: Session[];
  assignedIds: string[];
  onAssign: (sessionId: string) => void;
  onClose: () => void;
}

export function AssignPicker({ sessions, assignedIds, onAssign, onClose }: AssignPickerProps) {
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const unassigned = sessions.filter(
    (s) =>
      !assignedIds.includes(s.id) &&
      (!filter ||
        s.title.toLowerCase().includes(filter.toLowerCase()) ||
        s.repository.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="mx-2 my-1 border border-ov-border rounded bg-ov-bg shadow-sm max-h-40 flex flex-col">
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="Filter sessions..."
        className="text-xs bg-transparent border-b border-ov-border px-2 py-1 text-ov-text placeholder:text-ov-text-secondary outline-none"
      />
      <div className="flex-1 overflow-y-auto">
        {unassigned.length === 0 ? (
          <div className="text-[11px] text-ov-text-secondary p-2 text-center">
            No sessions to add
          </div>
        ) : (
          unassigned.slice(0, 20).map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-2 py-1 text-xs text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer truncate"
              onClick={() => onAssign(s.id)}
            >
              {s.title || s.id.slice(0, 12)}
              {s.repository && (
                <span className="text-[11px] text-ov-text-secondary ml-1">({s.repository})</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
