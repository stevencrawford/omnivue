import { useMemo } from "react";
import { Bookmark, Trash2, MessageSquareText } from "lucide-react";
import type { Bookmark as BookmarkType, Session } from "../hooks/useApi";

interface BookmarkPanelProps {
  bookmarks: BookmarkType[];
  sessions: Session[];
  onBookmarkSelect: (sessionId: string, messageIndex: number, toolCallId?: string) => void;
  onBookmarkDelete: (id: string) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

export function BookmarkPanel({
  bookmarks,
  sessions,
  onBookmarkSelect,
  onBookmarkDelete,
}: BookmarkPanelProps) {
  const sessionMap = useMemo(() => {
    const map: Record<string, Session> = {};
    for (const s of sessions) {
      map[s.id] = s;
    }
    return map;
  }, [sessions]);

  if (bookmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <Bookmark size={24} className="text-gh-text-secondary/40 mb-3" />
        <p className="text-xs text-gh-text-secondary/60 max-w-36 leading-relaxed">
          Bookmark tool calls and messages to jump back to them later.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-gh-border">
        <h2 className="text-[11px] font-semibold text-gh-text-secondary uppercase tracking-wider">
          Bookmarks
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {bookmarks.map((bm) => {
          const session = sessionMap[bm.sessionId];
          return (
            <div
              key={bm.id}
              className="group flex items-start gap-2 px-3 py-2 border-b border-gh-border/50 hover:bg-gh-bg-hover transition-colors cursor-pointer"
              onClick={() => onBookmarkSelect(bm.sessionId, bm.messageIndex, bm.toolCallId)}
            >
              <Bookmark size={12} className="mt-0.5 shrink-0 text-accent" fill="currentColor" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-gh-text truncate">{bm.label}</div>
                <div className="text-[10px] text-gh-text-secondary/60 truncate mt-0.5">
                  {session ? (
                    <span className="flex items-center gap-1">
                      <MessageSquareText size={10} className="shrink-0" />
                      <span className="truncate">{session.title || session.repository}</span>
                    </span>
                  ) : (
                    <span className="italic">Unknown session</span>
                  )}
                </div>
                <div className="text-[10px] text-gh-text-secondary/40 mt-0.5">
                  {formatTime(bm.createdAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBookmarkDelete(bm.id);
                }}
                className="shrink-0 size-6 flex items-center justify-center rounded text-gh-text-secondary/40 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                title="Remove bookmark"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
