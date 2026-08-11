import { useCallback, useEffect, useRef, useState } from "react";
import { ListTodo } from "lucide-react";
import type { Plan, BookmarkKind } from "../hooks/types";
import { fetchPlan } from "../hooks/apiClient";
import { PLAN_BOOKMARK_INDEX } from "../hooks/useBookmarks";
import { MarkdownContent } from "./MarkdownContent";
import { LoadingState } from "./LoadingState";
import { EmptyPanel } from "./EmptyPanel";
import { useToast } from "../hooks/useToast";

interface PlanViewProps {
  sessionId: string;
  refreshKey: number;
  searchHighlightQuery?: string | null;
  onBookmark?: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
    kind?: BookmarkKind,
  ) => void;
  bookmarkIdByRef?: Record<string, string>;
}

export function PlanView({
  sessionId,
  refreshKey,
  searchHighlightQuery,
  onBookmark,
  bookmarkIdByRef,
}: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { showErrorToast } = useToast();

  const planRefKey = `${sessionId}:${PLAN_BOOKMARK_INDEX}:`;
  const isBookmarked = bookmarkIdByRef ? !!bookmarkIdByRef[planRefKey] : false;
  const handleBookmarkPlan = useCallback(() => {
    if (!onBookmark) return;
    onBookmark(sessionId, PLAN_BOOKMARK_INDEX, undefined, "Plan", "plan");
  }, [onBookmark, sessionId]);

  useEffect(() => {
    return () => {
      for (const t of highlightTimers.current) clearTimeout(t);
      highlightTimers.current = [];
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlan(sessionId);
      setPlan(data);
    } catch (err) {
      showErrorToast(err, "Failed to load plan");
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId, refreshKey, showErrorToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Scroll to and highlight first element matching search highlight query
  useEffect(() => {
    if (!searchHighlightQuery || !scrollRef.current || !plan?.markdown) return;
    const q = searchHighlightQuery.toLowerCase();
    const container = scrollRef.current;
    const textNodes: Node[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
      if (walker.currentNode) textNodes.push(walker.currentNode);
    }
    for (const node of textNodes) {
      if ((node.textContent || "").toLowerCase().includes(q)) {
        const el = node.parentElement;
        if (el) {
          try {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch {
            /* noop */
          }
          el.classList.add("sess-message-highlight");
          const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
          highlightTimers.current.push(timer);
        }
        break;
      }
    }
  }, [searchHighlightQuery, plan]);

  if (loading && plan === null) {
    return <LoadingState label="Loading plan..." />;
  }

  if (!plan || !plan.markdown) {
    return <EmptyPanel icon={<ListTodo size={20} />} title="No plan for this session" />;
  }

  return (
    <div ref={scrollRef} className="px-6 py-5">
      <MarkdownContent
        content={plan.markdown}
        className="markdown-body--wide"
        onBookmark={handleBookmarkPlan}
        isBookmarked={isBookmarked}
      />
    </div>
  );
}
