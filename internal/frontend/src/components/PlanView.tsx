import { useCallback, useEffect, useRef, useState } from "react";
import { ListTodo } from "lucide-react";
import type { Plan } from "../hooks/types";
import { fetchPlan } from "../hooks/apiClient";
import { MarkdownContent } from "./MarkdownContent";
import { LoadingState } from "./LoadingState";
import { EmptyPanel } from "./EmptyPanel";
import { useToast } from "../hooks/useToast";

interface PlanViewProps {
  sessionId: string;
  refreshKey: number;
  searchHighlightQuery?: string | null;
}

export function PlanView({ sessionId, refreshKey, searchHighlightQuery }: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const highlightTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { showErrorToast } = useToast();

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
      <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
    </div>
  );
}
