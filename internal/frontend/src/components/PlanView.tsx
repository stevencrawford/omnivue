import { useEffect, useState } from "react";
import type { Plan } from "../hooks/useApi";
import { fetchPlan } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";

interface PlanViewProps {
  sessionId: string;
}

export function PlanView({ sessionId }: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchPlan(sessionId)
      .then((data) => {
        if (!cancelled) {
          setPlan(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gh-text-secondary">
        <span className="size-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        Loading plan...
      </div>
    );
  }

  if (error || !plan || !plan.markdown) {
    return (
      <div className="sess-empty-state flex-1">
        <div className="sess-empty-icon">
          <svg className="size-5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25h-8.5ZM5 5.75A.75.75 0 0 1 5.75 5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.75Z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gh-text">No plan for this session</p>
        <p className="text-xs text-gh-text-secondary">
          Plans appear when the agent writes implementation checkpoints.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-2 w-full">
      <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
    </div>
  );
}
