import type { Session } from "../hooks/types";

interface FilesPanelProps {
  sessions: Session[];
  onSessionSelect: (sessionId: string) => void;
}

// FilesPanel is the sidebar companion for the Touched Files section. The graph
// itself lives in the main canvas; this panel offers a short explainer and a
// quick jump back into the session list.
export function FilesPanel({ sessions, onSessionSelect }: FilesPanelProps) {
  return (
    <div className="flex flex-col overflow-hidden">
      <div className="border-b border-ov-border px-3 py-2 text-sm font-medium text-ov-text">
        Touched Files
      </div>
      <div className="px-3 py-3 text-xs leading-relaxed text-ov-text-secondary">
        A graph of files touched across sessions. Node size shows total read/write touches; color
        shows whether a file was mostly read (cyan) or written (amber). Edges connect files changed
        in the same session.
        <div className="mt-3">
          <button
            type="button"
            className="rounded border border-ov-border px-2 py-1 text-accent hover:bg-ov-bg-sidebar"
            onClick={() => {
              const recent = [...sessions].sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
              )[0];
              if (recent) onSessionSelect(recent.id);
            }}
          >
            Browse sessions
          </button>
        </div>
      </div>
    </div>
  );
}
