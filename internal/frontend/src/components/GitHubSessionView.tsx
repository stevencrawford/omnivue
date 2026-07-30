import {
  ExternalLink,
  Cloud,
  Clock,
  GitBranch,
  GitFork,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HelpCircle,
} from "lucide-react";
import type { Session } from "../hooks/useApi";

interface GitHubSessionViewProps {
  session: Session;
}

export function GitHubSessionView({ session }: GitHubSessionViewProps) {
  const prompt = session.todos?.find((t) => t.id === "initial_prompt")?.title || "";
  const taskId = session.todos?.find((t) => t.id === "task_id")?.title || "";
  const statusLabel = statusDisplay(session.status);
  const statusIcon = statusIconEl(session.status);
  const gitHubUrl = session.directory || `https://github.com/copilot/tasks/${session.id}`;
  const taskUrl = taskId ? `https://github.com/copilot/tasks/${taskId}` : gitHubUrl;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 space-y-5 max-w-lg">
        {/* Status banner */}
        <div
          className={`flex items-center gap-3 p-3 rounded-lg border ${
            session.status === "active" || session.status === "pending"
              ? "border-accent-border bg-accent-muted"
              : session.status === "waiting"
                ? "border-yellow-500/30 bg-yellow-500/10"
                : session.status === "completed"
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <div
            className={`${session.status === "active" || session.status === "pending" ? "animate-pulse" : ""}`}
          >
            {statusIcon}
          </div>
          <div>
            <p className="text-sm font-medium text-ov-text">{statusLabel}</p>
            <p className="text-[11px] text-ov-text-secondary">
              {session.status === "active" && "Running on GitHub-hosted compute"}
              {session.status === "pending" && "Queued — starting soon"}
              {session.status === "waiting" && "Waiting for your response on GitHub"}
              {session.status === "completed" && "Task completed successfully"}
            </p>
          </div>
        </div>

        {/* Metadata fields */}
        <div className="space-y-2">
          {session.model && (
            <MetaRow icon={<Cloud size={14} />} label="Model" value={session.model} />
          )}
          {session.repository && (
            <MetaRow icon={<GitFork size={14} />} label="Repository" value={session.repository} />
          )}
          {session.branch && (
            <MetaRow icon={<GitBranch size={14} />} label="Branch" value={session.branch} />
          )}
          <MetaRow
            icon={<Clock size={14} />}
            label="Created"
            value={formatAge(session.createdAt)}
          />
          <MetaRow
            icon={<Clock size={14} />}
            label="Updated"
            value={formatAge(session.updatedAt)}
          />
        </div>

        {/* Initial prompt */}
        {prompt && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-ov-text-secondary">
              Initial Prompt
            </p>
            <div className="p-3 rounded-lg bg-ov-bg-secondary border border-ov-border text-xs text-ov-text leading-relaxed whitespace-pre-wrap">
              {prompt}
            </div>
          </div>
        )}

        {/* View on GitHub button */}
        <a
          href={taskUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded-lg border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 transition-colors no-underline"
        >
          <ExternalLink size={16} />
          View on GitHub
        </a>
      </div>
    </div>
  );
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ov-text-secondary shrink-0">{icon}</span>
      <span className="text-ov-text-secondary min-w-[5rem]">{label}</span>
      <span className="text-ov-text font-mono truncate">{value}</span>
    </div>
  );
}

function statusDisplay(status: string): string {
  switch (status) {
    case "active":
      return "In Progress";
    case "pending":
      return "Queued";
    case "waiting":
      return "Needs Input";
    case "completed":
      return "Completed";
    case "archived":
      return "Cancelled";
    default:
      return status;
  }
}

function statusIconEl(status: string): React.ReactNode {
  switch (status) {
    case "active":
      return <Loader2 size={20} className="text-accent animate-spin" />;
    case "pending":
      return <Clock size={20} className="text-ov-text-secondary" />;
    case "waiting":
      return <HelpCircle size={20} className="text-yellow-400" />;
    case "completed":
      return <CheckCircle2 size={20} className="text-emerald-400" />;
    default:
      return <AlertCircle size={20} className="text-red-400" />;
  }
}

function formatAge(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
