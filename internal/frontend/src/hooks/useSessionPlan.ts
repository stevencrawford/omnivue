import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan } from "./types";
import { fetchPlan } from "./apiClient";

export interface SessionPlanState {
  plan: Plan | null;
  /** True only while the initial, user-visible fetch is in flight. */
  planLoading: boolean;
  /** Re-fetch the plan; pass `background` to skip the loading indicator. */
  reloadPlan: (background?: boolean) => Promise<void>;
}

/**
 * Loads a session's plan and keeps it fresh.
 *
 * The plan is derived from data that can change independently of the session
 * row the session list reports on (a sub-agent's plan comes from its parent's
 * task output, and file-backed plans may land after the last transcript
 * write). Waiting for a `session-changed` event for the selected session is
 * therefore not enough: the tab would only appear after a page reload.
 *
 * `pollTick` is the caller's server-poll pulse. Bumping it re-checks the plan
 * in the background, so a plan that becomes available between session changes
 * reveals itself (and its tab) without a reload. Content-identical polls are
 * discarded so a poll never re-renders the Plan pane.
 */
export function useSessionPlan(sessionId: string, pollTick = 0): SessionPlanState {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  // The tick the hook mounted on is already covered by the initial fetch.
  const mountedTick = useRef(pollTick);

  const reloadPlan = useCallback(
    async (background = false) => {
      if (!background) setPlanLoading(true);
      try {
        const data = await fetchPlan(sessionId);
        // Avoid re-rendering the Plan tab when the polled content is
        // identical — a new object identity alone would flash the view.
        setPlan((prev) => {
          if (prev?.markdown === data?.markdown && prev?.source === data?.source) return prev;
          return data;
        });
      } catch {
        if (!background) setPlan(null);
      } finally {
        if (!background) setPlanLoading(false);
      }
    },
    [sessionId],
  );

  // Initial fetch for the session: the only one that shows a spinner.
  useEffect(() => {
    setPlan(null);
    void reloadPlan();
  }, [reloadPlan]);

  // Background re-check on each server poll pulse.
  useEffect(() => {
    if (pollTick === mountedTick.current) return;
    void reloadPlan(true);
  }, [pollTick, reloadPlan]);

  return { plan, planLoading, reloadPlan };
}
