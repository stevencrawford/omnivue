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
      <div className="flex-1 flex items-center justify-center text-sm text-gh-text-secondary">
        Loading plan...
      </div>
    );
  }

  if (error || !plan || !plan.markdown) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gh-text-secondary">
        No plan found for this session
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">
      <MarkdownContent content={plan.markdown} />
    </div>
  );
}
