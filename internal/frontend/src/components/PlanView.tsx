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
      <div className="p-8 text-center">
        <div className="inline-block animate-pulse text-sm text-gh-text-secondary">
          Loading plan...
        </div>
      </div>
    );
  }

  if (!plan || !plan.markdown) {
    return (
      <div className="p-8 text-center text-sm text-gh-text-secondary">
        No plan for this session
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl">
      <MarkdownContent content={plan.markdown} />
    </div>
  );
}
