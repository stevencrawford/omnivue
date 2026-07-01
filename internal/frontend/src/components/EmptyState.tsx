import { Copy, Check } from "lucide-react";
import { useCopy } from "../hooks/useCopy";

interface EmptyStateProps {
  sessionsCount: number;
  onOpenSettings: () => void;
}

export function EmptyState({ sessionsCount, onOpenSettings }: EmptyStateProps) {
  const { copied: initCopied, copy: copyInit } = useCopy(1500);

  if (sessionsCount === 0) {
    return (
      <div className="sess-empty-state flex-1 h-full">
        <div className="flex flex-col items-center gap-3 max-w-xs">
          <svg
            className="size-8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-sm font-medium text-ov-text">No sessions yet</p>
          <p className="text-xs text-ov-text-secondary text-center leading-relaxed">
            Add agent directories so Omnivue can discover your AI coding sessions.
          </p>
          <p className="text-xs text-ov-text-secondary text-center leading-relaxed">
            Supported: OpenCode, Copilot, Cursor, Pi, Codex
          </p>
          <div className="w-full">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyInit("omnivue init");
              }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-ov-border bg-ov-bg-secondary text-xs font-mono text-ov-text select-none cursor-pointer transition-colors hover:bg-ov-bg-hover"
              title="Copy command"
            >
              <span className="flex-1 text-left">$ omnivue init</span>
              {initCopied ? (
                <Check className="size-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Copy className="size-3.5 shrink-0 text-ov-text-secondary" />
              )}
            </button>
          </div>
          <p className="text-xs text-ov-text-secondary">or</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs px-3 py-1.5 rounded-md border border-accent-border bg-accent-muted text-accent hover:bg-accent/20 cursor-pointer transition-colors"
          >
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sess-empty-state flex-1 h-full">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="size-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <p className="text-sm font-medium text-ov-text">Select a session</p>
        <p className="text-xs text-ov-text-secondary max-w-xs">
          Pick a session from the sidebar to view conversation, plan, and diffs.
        </p>
      </div>
    </div>
  );
}
