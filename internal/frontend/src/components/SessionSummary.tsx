import { Timer, DollarSign, Activity, Zap } from "lucide-react";
import type { Session, Message } from "../hooks/useApi";
import { useSessionSummary } from "../hooks/useSessionSummary";
import { useSessionTokenomics } from "../hooks/useSessionTokenomics";
import { useHideCosts } from "../hooks/useHideCosts";
import { formatCost, formatTokens } from "../utils/sessionUtils";
import { ActivityBreakdown } from "./sessionSummary/ActivityBreakdown";
import { TokenBreakdownPie } from "./sessionSummary/TokenBreakdownPie";
import { TokenTimelineChart } from "./sessionSummary/TokenTimelineChart";
import { CostTimelineChart } from "./sessionSummary/CostTimelineChart";
import { EffectivenessCards } from "./sessionSummary/EffectivenessCards";
import { formatDuration } from "./sessionSummary/format";

interface SessionSummaryProps {
  session: Session;
  messages: Message[];
}

export function SessionSummary({ session, messages }: SessionSummaryProps) {
  const hideCosts = useHideCosts();
  const { categories, totalCount, totalDuration, hasTiming } = useSessionSummary(messages);
  const { tokenTimeline, effectiveness } = useSessionTokenomics(messages, session);

  if (totalCount === 0) {
    return (
      <div className="sess-empty-state p-8 h-full">
        <div className="sess-empty-icon">
          <Activity size={20} />
        </div>
        <p className="text-sm text-ov-text-secondary">No session data to summarize</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-5 pb-2 space-y-5">
        <section>
          <EffectivenessCards metrics={effectiveness} />
        </section>

        <ActivityBreakdown categories={categories} hasTiming={hasTiming} />

        <section>
          <div className="sess-overview-section-header">
            <Zap size={14} />
            <h3>Token Breakdown</h3>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-1">
              <TokenBreakdownPie
                tokensInput={session.tokensInput}
                tokensOutput={session.tokensOutput}
                tokensCached={session.tokensCacheRead}
                tokensReasoning={session.tokensReasoning}
              />
            </div>
            <div className="col-span-3">
              <TokenTimelineChart timeline={tokenTimeline} />
            </div>
          </div>
        </section>

        <CostTimelineChart timeline={tokenTimeline} hideCosts={hideCosts} />
      </div>

      {(session.cost > 0 || totalDuration > 0 || totalCount > 0) && (
        <div className="mt-auto border-t border-ov-border">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-xs text-ov-text-secondary">
            <div className="flex items-center gap-1.5">
              <Activity size={12} />
              <span className="tabular-nums">{totalCount} total actions</span>
            </div>
            {hasTiming && totalDuration > 0 && (
              <div className="flex items-center gap-1.5">
                <Timer size={12} />
                <span className="tabular-nums">{formatDuration(totalDuration)} total</span>
              </div>
            )}
            {session.cost > 0 && (
              <div className="flex items-center gap-1.5">
                <DollarSign size={12} />
                <span className="tabular-nums font-medium text-ov-text">
                  {hideCosts ? "***" : formatCost(session.cost)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 tabular-nums">
              <span className="font-medium text-ov-text">
                {formatTokens(effectiveness.totalTokens)}
              </span>
              <span>total tokens</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
