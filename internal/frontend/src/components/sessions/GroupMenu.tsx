import type { GroupMode } from "../../utils/buildTree";

const GROUP_LABELS: Record<GroupMode, string> = {
  repo: "Repo",
  cwd: "CWD",
  model: "Model",
  none: "None",
};

interface GroupMenuProps {
  open: boolean;
  groupMode: GroupMode;
  onSelect: (mode: GroupMode) => void;
}

export function GroupMenu({ open, groupMode, onSelect }: GroupMenuProps) {
  if (!open) return null;
  return (
    <div className="absolute right-0 top-full mt-1 w-24 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1">
      {(Object.keys(GROUP_LABELS) as GroupMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
            groupMode === mode
              ? "text-ov-text bg-ov-bg-active"
              : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
          }`}
          onClick={() => onSelect(mode)}
        >
          {GROUP_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
