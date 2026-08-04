import { GitBranch } from "lucide-react";
import type { Session } from "../../hooks/types";
import { sortByRecent } from "../../utils/overviewAnalytics";
import { MiniSessionRow } from "./MiniSessionRow";

interface RepoCardProps {
  repoLabel: string;
  repoPath: string;
  sessions: Session[];
  onSessionSelect: (id: string) => void;
}

export function RepoCard({ repoLabel, repoPath, sessions, onSessionSelect }: RepoCardProps) {
  const recent = sortByRecent(sessions).slice(0, 3);

  return (
    <div className="sess-overview-card">
      <div className="flex items-center gap-2 mb-3">
        <span className="size-7 rounded-md flex items-center justify-center shrink-0 bg-ov-bg-hover">
          <GitBranch size={14} className="text-ov-text-secondary" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium truncate" title={repoPath}>
            {repoLabel}
          </h3>
          <p className="text-[11px] text-ov-text-secondary tabular-nums">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
      <div className="space-y-0.5">
        {recent.map((s) => (
          <MiniSessionRow key={s.id} session={s} onSelect={() => onSessionSelect(s.id)} showModel />
        ))}
      </div>
    </div>
  );
}
