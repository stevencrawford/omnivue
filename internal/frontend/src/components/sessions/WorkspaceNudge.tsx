import { useState } from "react";
import { FolderGit2, X } from "lucide-react";
import { STORAGE_KEYS, getStorageItem, setStorageItem } from "../../utils/storageKeys";

interface WorkspaceNudgeProps {
  /** Whether the nudge is relevant (git data exists and grouping is not workspace). */
  show: boolean;
  onEnable: () => void;
}

/**
 * A one-time hint for users whose sessions span worktrees. It never blocks the
 * list and can be dismissed permanently; the information stays available in the
 * group menu afterwards.
 */
export function WorkspaceNudge({ show, onEnable }: WorkspaceNudgeProps) {
  const [dismissed, setDismissed] = useState(
    () => getStorageItem(STORAGE_KEYS.SIDEBAR_WORKSPACE_NUDGE) === "1",
  );

  if (!show || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    setStorageItem(STORAGE_KEYS.SIDEBAR_WORKSPACE_NUDGE, "1");
  };

  return (
    <div className="mx-1.5 mb-1 flex items-start gap-1.5 rounded-md border border-ov-border bg-ov-bg-active/60 px-2 py-1.5">
      <FolderGit2 size={13} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-snug text-ov-text">Sessions span multiple worktrees.</p>
        <button
          type="button"
          onClick={onEnable}
          className="mt-0.5 text-[11px] font-medium text-accent hover:underline cursor-pointer"
        >
          Group by workspace
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        title="Dismiss"
        aria-label="Dismiss workspace hint"
        className="shrink-0 text-ov-text-secondary hover:text-ov-text cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}
