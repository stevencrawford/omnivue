import { Activity, FileDiff, FileText, MessageSquare } from "lucide-react";
import type { ActivityFilters } from "../../utils/activityFilters";
import { ActivityFilterMenu } from "./ActivityFilterMenu";

/** The four panes of the session workspace. */
export type SessionTab = "prompt" | "activity" | "plan" | "diffs";

const TABS: ReadonlyArray<{
  id: SessionTab;
  label: string;
  Icon: typeof Activity;
}> = [
  { id: "prompt", label: "Prompt", Icon: MessageSquare },
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "plan", label: "Plan", Icon: FileText },
  { id: "diffs", label: "Diffs", Icon: FileDiff },
];

interface SessionTabBarProps {
  active: SessionTab;
  onChange: (tab: SessionTab) => void;
  activityFilters: ActivityFilters;
  onActivityFiltersChange: (next: ActivityFilters) => void;
}

/**
 * Single tab strip for the session workspace. Every tab is timeline-driven;
 * switching tabs only changes which pane is visible, not what the cursor shows.
 */
export function SessionTabBar({
  active,
  onChange,
  activityFilters,
  onActivityFiltersChange,
}: SessionTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Session panes"
      className="flex items-center px-3 h-10 border-b border-ov-border bg-surface-elevated shrink-0 min-w-0"
    >
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          id={`session-tab-${id}`}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`session-panel-${id}`}
          onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3 h-full text-xs font-medium border-b-2 cursor-pointer transition-colors ${
            active === id
              ? "border-accent text-ov-text bg-ov-bg"
              : "border-transparent text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover"
          }`}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-0.5">
        {active === "activity" && (
          <ActivityFilterMenu filters={activityFilters} onChange={onActivityFiltersChange} />
        )}
      </div>
    </div>
  );
}
