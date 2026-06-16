import { useCallback, useEffect, useState } from "react";
import type { Plan } from "../hooks/useApi";
import { fetchPlan } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";

interface PlanViewProps {
  sessionId: string;
}

export function PlanView({ sessionId }: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);

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
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

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
      <div className="sess-empty-state p-8">
        <div className="sess-empty-icon">
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 9 3.25V1.5H3.75Z" />
          </svg>
        </div>
        <p className="text-sm text-gh-text-secondary">No plan for this session</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="bg-surface-elevated border border-gh-border rounded-xl p-4">
        <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
      </div>
    </div>
  );
}
