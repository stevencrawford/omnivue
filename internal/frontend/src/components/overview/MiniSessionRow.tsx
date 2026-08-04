import { ResumeButton } from "../ResumeButton";
import type { Session } from "../../hooks/useApi";
import { agentLabel } from "../../utils/overviewAnalytics";
import {
  relativeTime,
  sessionMetaParts,
  sessionTitle,
  shortModel,
} from "../../utils/sessionUtils";

interface MiniSessionRowProps {
  session: Session;
  onSelect: () => void;
  showModel?: boolean;
}

export function MiniSessionRow({ session, onSelect, showModel }: MiniSessionRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="sess-overview-session-row group"
      title={session.directory || session.repository}
    >
      {!showModel && (
        <span className={`sess-agent-badge sess-agent-badge--${session.agent} shrink-0`}>
          {agentLabel(session.agent).slice(0, 1)}
        </span>
      )}
      {showModel ? (
        <span className="flex-1 min-w-0 text-left">
          <span className="flex items-center gap-2">
            <span className="flex-1 text-xs truncate">{sessionTitle(session)}</span>
            <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
              {relativeTime(session.updatedAt)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={`sess-agent-badge sess-agent-badge--${session.agent}`}>
              {agentLabel(session.agent)}
            </span>
            <span className="text-[11px] text-ov-text-secondary truncate">
              {shortModel(session.model) || session.model}
            </span>
          </span>
        </span>
      ) : (
        <span className="flex-1 min-w-0 text-left">
          <span className="block text-xs truncate group-hover:text-accent transition-colors">
            {sessionTitle(session)}
          </span>
          <span className="block text-[11px] text-ov-text-secondary truncate">
            {sessionMetaParts(session).join(" · ")}
          </span>
        </span>
      )}
      {!showModel && (
        <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
          {relativeTime(session.updatedAt)}
        </span>
      )}
      <ResumeButton sessionId={session.id} />
    </button>
  );
}