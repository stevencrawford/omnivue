import { FileText, Maximize2 } from "lucide-react";
import type { BookmarkKind, Plan, Session } from "../../hooks/types";
import { MarkdownContent } from "../ui/MarkdownContent";
import { BookmarkButton } from "../tool-renderers/BookmarkButton";
import { PLAN_BOOKMARK_MESSAGE_ID, bookmarkRefKey } from "../../hooks/useBookmarks";
import { LoadingState } from "../ui/LoadingState";
import { EmptyPanel } from "../ui/EmptyPanel";

interface PlanPanelProps {
  session: Session;
  plan?: Plan | null;
  planLoading?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onBookmark?: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
    kind?: BookmarkKind,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
  onPin?: (content: string) => void;
}

/** The session plan, timeline-independent but surfaced beside the activity. */
export function PlanPanel({
  session,
  plan,
  planLoading,
  onOpenModal,
  onBookmark,
  bookmarkIdByRef,
  onPin,
}: PlanPanelProps) {
  const planContent = plan?.markdown ?? "";
  const planRefKey = bookmarkRefKey(session.id, PLAN_BOOKMARK_MESSAGE_ID, undefined);
  const planBookmarked = bookmarkIdByRef ? !!bookmarkIdByRef[planRefKey] : false;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4">
      {planLoading ? (
        <LoadingState label="Loading plan…" className="h-32" />
      ) : planContent ? (
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5 mb-2 min-w-0">
            <FileText size={12} className="text-ov-text-secondary shrink-0" />
            <span className="text-[11px] font-semibold text-ov-text-secondary">Plan</span>
            <span className="ml-auto flex items-center gap-0.5 shrink-0">
              {onBookmark && (
                <BookmarkButton
                  isBookmarked={planBookmarked}
                  onClick={() =>
                    onBookmark(session.id, PLAN_BOOKMARK_MESSAGE_ID, undefined, "Plan", "plan")
                  }
                  size="sm"
                />
              )}
              {onOpenModal && (
                <button
                  type="button"
                  onClick={() => onOpenModal(planContent, "Plan")}
                  className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                  title="Expand plan"
                  aria-label="Expand plan"
                >
                  <Maximize2 size={12} />
                </button>
              )}
            </span>
          </div>
          <div className="relative group min-w-0 overflow-hidden">
            <MarkdownContent
              content={planContent}
              className="markdown-body--wide text-xs min-w-0 wrap-break-word"
              onPin={onPin}
            />
          </div>
        </div>
      ) : (
        <EmptyPanel icon={<FileText size={20} />} title="No plan for this session yet" />
      )}
    </div>
  );
}
