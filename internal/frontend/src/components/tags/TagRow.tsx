import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import type { Session, Tag } from "../../hooks/types";
import { tagColor, hasTagColor } from "../../utils/tagColors";
import { AssignPicker } from "./AssignPicker";
import { TagSessionRow } from "./TagSessionRow";

interface TagRowProps {
  tag: Tag;
  sessions: Session[];
  tagSessionIds: string[];
  expanded: boolean;
  editing: boolean;
  editName: string;
  assigning: boolean;
  activeSessionId: string | null;
  editRef: React.RefObject<HTMLInputElement | null>;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onEditNameChange: (value: string) => void;
  onRename: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onToggleAssign: () => void;
  onAssign: (sessionId: string) => void;
  onCloseAssign: () => void;
  onUnassign: (sessionId: string) => void;
  onDrop: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

export function TagRow({
  tag,
  sessions,
  tagSessionIds,
  expanded,
  editing,
  editName,
  assigning,
  activeSessionId,
  editRef,
  onToggleExpand,
  onStartEdit,
  onEditNameChange,
  onRename,
  onCancelEdit,
  onDelete,
  onToggleAssign,
  onAssign,
  onCloseAssign,
  onUnassign,
  onDrop,
  onSelectSession,
}: TagRowProps) {
  const getSession = (id: string) => sessions.find((s) => s.id === id);

  return (
    <div className="group">
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded transition-colors hover:bg-ov-bg-hover"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const sessionId = e.dataTransfer.getData("text/plain");
          if (sessionId) onDrop(sessionId);
        }}
      >
        {editing ? (
          <input
            ref={editRef}
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename();
              if (e.key === "Escape") onCancelEdit();
            }}
            onBlur={onRename}
            className="flex-1 text-xs bg-ov-bg border border-ov-border rounded-md px-1.5 py-0.5 text-ov-text outline-none focus:border-accent"
          />
        ) : (
          <button
            type="button"
            className="flex items-center gap-1.5 flex-1 text-xs cursor-pointer truncate transition-colors text-ov-text-secondary hover:text-ov-text"
            onClick={onToggleExpand}
          >
            <ChevronRight
              size={10}
              className={`transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
            />
            {hasTagColor(tag.color) ? (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tagColor(tag.color) }}
              />
            ) : (
              <span className="w-2 h-2 shrink-0" />
            )}
            <span className="truncate">{tag.name}</span>
            {tagSessionIds && (
              <span className="text-[11px] text-ov-text-secondary ml-auto tabular-nums">
                {tagSessionIds.length}
              </span>
            )}
          </button>
        )}
        {!editing && (
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onToggleAssign}
              className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
              title="Add session"
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              onClick={onStartEdit}
              className="text-ov-text-secondary hover:text-ov-text cursor-pointer p-0.5"
              title="Rename"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="text-ov-text-secondary hover:text-red-400 cursor-pointer p-0.5"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {assigning && (
        <AssignPicker
          sessions={sessions}
          assignedIds={tagSessionIds}
          onAssign={onAssign}
          onClose={onCloseAssign}
        />
      )}

      {expanded && tagSessionIds && tagSessionIds.length > 0 && (
        <div>
          {tagSessionIds.map((sid) => {
            const sess = getSession(sid);
            if (!sess) return null;
            return (
              <TagSessionRow
                key={sid}
                session={sess}
                isActive={sid === activeSessionId}
                onSelect={() => onSelectSession(sid)}
                onRemove={() => onUnassign(sid)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
