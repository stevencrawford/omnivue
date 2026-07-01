import { useState } from "react";
import { Bot, ChevronDown, Zap } from "lucide-react";
import type { AgentStats, ModelStats } from "../utils/overviewAnalytics";
import { formatCost, formatTokens } from "../utils/sessionUtils";

interface TokenSegment {
  label: string;
  value: number;
  color: string;
}

interface ModelAgentBreakdownProps {
  models: ModelStats[];
  agents: AgentStats[];
  hideCosts: boolean;
  maxModelTokens: number;
  maxAgentTokens: number;
  totalTokens: number;
  tokenSegments: TokenSegment[];
  latestSessionTokens?: string;
  latestSessionCost?: number;
}

// ---------------------------------------------------------------------------
// ModelBreakdown
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ROWS = 5;

function ModelBreakdown({
  models,
  hideCosts,
  maxTokens,
}: {
  models: ModelStats[];
  hideCosts: boolean;
  maxTokens: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? models : models.slice(0, DEFAULT_MODEL_ROWS);
  const hasMore = models.length > DEFAULT_MODEL_ROWS;

  return (
    <div>
      {visible.map((m) => {
        const pct = maxTokens > 0 ? (m.tokens / maxTokens) * 100 : 0;
        return (
          <div key={m.model} className="ov-breakdown-row">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono truncate min-w-0" title={m.label}>
                  {m.label}
                </span>
                <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
                  {m.sessions} session{m.sessions !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="ov-breakdown-bar-track">
                <div className="ov-breakdown-bar" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="text-xs font-semibold tabular-nums">{formatTokens(m.tokens)}</p>
              {!hideCosts && m.cost > 0 && (
                <p className="text-[11px] text-ov-text-secondary tabular-nums">
                  {formatCost(m.cost)}
                </p>
              )}
            </div>
          </div>
        );
      })}
      {hasMore && (
        <button
          type="button"
          className="ov-breakdown-expand"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown
            size={12}
            className={`ov-breakdown-expand-chevron${expanded ? " ov-breakdown-expand-chevron--open" : ""}`}
          />
          {expanded ? "Show less" : `Show all ${models.length} models`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentBreakdown
// ---------------------------------------------------------------------------

function AgentBreakdown({
  agents,
  hideCosts,
  maxTokens,
}: {
  agents: AgentStats[];
  hideCosts: boolean;
  maxTokens: number;
}) {
  if (agents.length === 0) {
    return <p className="text-xs text-ov-text-secondary italic">No agent data.</p>;
  }

  return (
    <div>
      {agents.map((a) => {
        const pct = maxTokens > 0 ? (a.tokens / maxTokens) * 100 : 0;
        return (
          <div key={a.agent} className="ov-breakdown-row">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs truncate min-w-0" title={a.label}>
                  {a.label}
                </span>
                <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
                  {a.sessions} session{a.sessions !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="ov-breakdown-bar-track">
                <div
                  className="ov-breakdown-bar ov-breakdown-bar--agent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="text-xs font-semibold tabular-nums">{formatTokens(a.tokens)}</p>
              {!hideCosts && a.cost > 0 && (
                <p className="text-[11px] text-ov-text-secondary tabular-nums">
                  {formatCost(a.cost)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelAgentBreakdown
// ---------------------------------------------------------------------------

export function ModelAgentBreakdown({
  models,
  agents,
  hideCosts,
  maxModelTokens,
  maxAgentTokens,
  totalTokens,
  tokenSegments,
  latestSessionCost,
  latestSessionTokens,
}: ModelAgentBreakdownProps) {
  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="sess-overview-card">
          <div className="sess-overview-section-header !mb-3">
            <Bot size={14} />
            <h3>Models</h3>
            <span className="ml-auto text-[11px] text-ov-text-secondary tabular-nums">
              {models.length}
            </span>
          </div>
          {models.length === 0 ? (
            <p className="text-xs text-ov-text-secondary italic">No model data yet.</p>
          ) : (
            <ModelBreakdown models={models} hideCosts={hideCosts} maxTokens={maxModelTokens} />
          )}
        </div>

        <div className="sess-overview-card">
          <div className="sess-overview-section-header !mb-3">
            <Zap size={14} />
            <h3>Agents</h3>
            <span className="ml-auto text-[11px] text-ov-text-secondary tabular-nums">
              {agents.length}
            </span>
          </div>
          <AgentBreakdown agents={agents} hideCosts={hideCosts} maxTokens={maxAgentTokens} />
        </div>

        <div className="sess-overview-card">
          <div className="sess-overview-section-header !mb-3">
            <Zap size={14} />
            <h3>Token breakdown</h3>
          </div>
          <div className="space-y-4">
            <div className="flex h-2 rounded-full overflow-hidden bg-ov-bg-hover">
              {tokenSegments.map((seg) => (
                <div
                  key={seg.label}
                  style={{
                    width: `${(seg.value / totalTokens) * 100}%`,
                    background: seg.color,
                  }}
                  title={`${seg.label}: ${formatTokens(seg.value)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tokenSegments.map((seg) => (
                <div key={seg.label} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ background: seg.color }}
                  />
                  <span className="text-ov-text-secondary">{seg.label}</span>
                  <span className="ml-auto tabular-nums">{formatTokens(seg.value)}</span>
                </div>
              ))}
            </div>
            {(latestSessionTokens || (latestSessionCost && latestSessionCost > 0)) && (
              <p className="text-[11px] text-ov-text-secondary border-t border-ov-border pt-3">
                Latest session: {latestSessionTokens}
                {!hideCosts && latestSessionCost && latestSessionCost > 0 && (
                  <> · {formatCost(latestSessionCost)}</>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
