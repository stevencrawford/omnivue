import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "../hooks/useApi";
import { fetchPlan } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";

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
    } catch {
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId, refreshKey]);

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
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("sess-message-highlight");
          const timer = setTimeout(() => el.classList.remove("sess-message-highlight"), 2000);
          highlightTimers.current.push(timer);
        }
        break;
      }
    }
  }, [searchHighlightQuery, plan]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-sm text-gh-text-secondary">
        <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading plan...
      </div>
    );
  }

  if (!plan || !plan.markdown) {
    return (
      <div className="sess-empty-state p-8 h-full">
        <div className="sess-empty-icon">
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5Zm1.75-.25a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25h-8.5ZM6.5 5.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75Zm0 3a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75ZM5 5.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm0 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
          </svg>
        </div>
        <p className="text-sm text-gh-text-secondary">No plan for this session</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="px-6 py-5">
      <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
    </div>
  );
}
