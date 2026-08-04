import { X } from "lucide-react";
import type { Session } from "../../hooks/types";
import { sessionTitle, sessionMetaParts, relativeTime } from "../../utils/sessionUtils";

interface TagSessionRowProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

export function TagSessionRow({ session, isActive, onSelect, onRemove }: TagSessionRowProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="group/item relative">
      <button
        type="button"
        draggable
        onDragStart={handleDragStart}
        onClick={onSelect}
        title={session.directory || session.repository}
        className={`session-draggable sess-parent-session w-full text-left transition-all ${
          isActive ? "sess-session-active" : "hover:bg-ov-bg-hover"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 pr-6">
          <span className="sess-parent-session-title truncate flex-1 text-ov-text">
            {sessionTitle(session)}
          </span>
          <span className="shrink-0 text-[11px] text-ov-text-secondary tabular-nums">
            {relativeTime(session.updatedAt)}
          </span>
        </div>
        {sessionMetaParts(session).length > 0 && (
          <p className="sess-parent-session-meta truncate mt-0.5 pr-6">
            {sessionMetaParts(session).join(" · ")}
          </p>
        )}
      </button>
      <button
        type="button"
        className="hidden group-hover/item:block absolute right-1 top-1/2 -translate-y-1/2 text-ov-text-secondary hover:text-red-400 cursor-pointer p-0.5"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove tag"
      >
        <X size={10} />
      </button>
    </div>
  );
}
