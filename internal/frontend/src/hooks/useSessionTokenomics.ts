import { useMemo } from "react";
import type { Message, Session } from "./types";
import { effectiveToolKind } from "../utils/toolDisplay";
import { TOKEN_COLOR_SEGMENTS, toolKindInfo } from "../utils/toolKindTaxonomy";

export interface TokenTimelinePoint {
  stepIndex: number;
  timestamp: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  tokensReasoning: number;
  cost: number;
  cumulativeTotal: number;
  cumulativeInput: number;
  cumulativeOutput: number;
  cumulativeCached: number;
  cumulativeReasoning: number;
  cumulativeCost: number;
}

export interface ToolTokenStat {
  kind: string;
  label: string;
  color: string;
  tokens: number;
  count: number;
}

export interface EffectivenessMetrics {
  cacheHitRate: number | null;
  efficiencyRatio: number | null;
  tokensPerToolCall: number | null;
  toolSuccessRate: number | null;

  costPerFile: number | null;
  totalTokens: number;
  totalToolCalls: number;
}

export interface SessionTokenomics {
  tokenTimeline: TokenTimelinePoint[];
  toolTokenStats: ToolTokenStat[];
  effectiveness: EffectivenessMetrics;
}

export const TOKENS_COLOR_INPUT = TOKEN_COLOR_SEGMENTS.input;
export const TOKENS_COLOR_OUTPUT = TOKEN_COLOR_SEGMENTS.output;
export const TOKENS_COLOR_CACHE = TOKEN_COLOR_SEGMENTS.cache;
export const TOKENS_COLOR_REASONING = TOKEN_COLOR_SEGMENTS.reasoning;

export function useSessionTokenomics(messages: Message[], session: Session): SessionTokenomics {
  return useMemo(() => {
    const timeline: TokenTimelinePoint[] = [];
    let cumInput = 0;
    let cumOutput = 0;
    let cumCached = 0;
    let cumReasoning = 0;
    let cumCost = 0;
    let stepCounter = 0;

    for (const msg of messages) {
      if (!msg.stepEvents) continue;
      for (const ev of msg.stepEvents) {
        if (ev.step !== "finish" || !ev.tokens) continue;
        const t = ev.tokens;
        cumInput += t.input;
        cumOutput += t.output;
        cumCached += t.cacheRead;
        cumReasoning += t.reasoning;
        cumCost += ev.cost ?? 0;
        timeline.push({
          stepIndex: stepCounter,
          timestamp: msg.timestamp,
          tokensInput: t.input,
          tokensOutput: t.output,
          tokensCached: t.cacheRead,
          tokensReasoning: t.reasoning,
          cost: ev.cost ?? 0,
          cumulativeTotal: cumInput + cumOutput + cumCached + cumReasoning,
          cumulativeInput: cumInput,
          cumulativeOutput: cumOutput,
          cumulativeCached: cumCached,
          cumulativeReasoning: cumReasoning,
          cumulativeCost: cumCost,
        });
        stepCounter++;
      }
    }

    // Fallback: build timeline from message-level tokens when no step events exist
    if (timeline.length === 0) {
      for (const msg of messages) {
        if (msg.role !== "assistant") continue;
        const input = msg.tokensInput ?? 0;
        const output = msg.tokensOutput ?? 0;
        if (input === 0 && output === 0) continue;
        cumInput += input;
        cumOutput += output;
        timeline.push({
          stepIndex: stepCounter,
          timestamp: msg.timestamp,
          tokensInput: input,
          tokensOutput: output,
          tokensCached: 0,
          tokensReasoning: 0,
          cost: 0,
          cumulativeTotal: cumInput + cumOutput + cumCached + cumReasoning,
          cumulativeInput: cumInput,
          cumulativeOutput: cumOutput,
          cumulativeCached: cumCached,
          cumulativeReasoning: cumReasoning,
          cumulativeCost: cumCost,
        });
        stepCounter++;
      }
    }

    // Third fallback: single point from session-level totals (e.g. Copilot)
    if (timeline.length === 0) {
      const si = session.tokensInput;
      const so = session.tokensOutput;
      const sc = session.tokensCacheRead;
      const sr = session.tokensReasoning;
      const totalTokens = si + so + sc + sr;
      if (totalTokens > 0) {
        timeline.push({
          stepIndex: 0,
          timestamp: "",
          tokensInput: si,
          tokensOutput: so,
          tokensCached: sc,
          tokensReasoning: sr,
          cost: session.cost,
          cumulativeTotal: totalTokens,
          cumulativeInput: si,
          cumulativeOutput: so,
          cumulativeCached: sc,
          cumulativeReasoning: sr,
          cumulativeCost: session.cost,
        });
      }
    }

    const toolCalls: { kind: string; status: string }[] = [];
    for (const msg of messages) {
      if (!msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        toolCalls.push({
          kind: effectiveToolKind(tc),
          status: tc.status,
        });
      }
    }

    const totalStepTokens =
      timeline.length > 0
        ? timeline[timeline.length - 1].cumulativeTotal
        : session.tokensInput +
          session.tokensOutput +
          session.tokensCacheRead +
          session.tokensReasoning;

    const toolKindCounts = new Map<string, number>();
    for (const tc of toolCalls) {
      toolKindCounts.set(tc.kind, (toolKindCounts.get(tc.kind) ?? 0) + 1);
    }

    const totalToolCalls = toolCalls.length;
    const toolTokenStats: ToolTokenStat[] = [];
    for (const [kind, count] of toolKindCounts) {
      const tokens =
        totalToolCalls > 0 ? Math.round(totalStepTokens * (count / totalToolCalls)) : 0;
      toolTokenStats.push({
        kind,
        label: toolKindInfo(kind).label,
        color: toolKindInfo(kind).color,
        tokens,
        count,
      });
    }
    toolTokenStats.sort((a, b) => b.tokens - a.tokens);

    const totalTokens =
      session.tokensInput +
      session.tokensOutput +
      session.tokensCacheRead +
      session.tokensReasoning;

    const cacheHitRate =
      session.tokensInput + session.tokensCacheRead > 0
        ? (session.tokensCacheRead / (session.tokensInput + session.tokensCacheRead)) * 100
        : null;

    const efficiencyRatio =
      session.tokensInput > 0 ? session.tokensOutput / session.tokensInput : null;

    const tokensPerToolCall = totalToolCalls > 0 ? totalTokens / totalToolCalls : null;

    const successfulTools = toolCalls.filter(
      (tc) => tc.status !== "error" && tc.status !== "failed",
    ).length;
    const toolSuccessRate = totalToolCalls > 0 ? (successfulTools / totalToolCalls) * 100 : null;

    const costPerFile = session.diffFiles > 0 ? session.cost / session.diffFiles : null;

    return {
      tokenTimeline: timeline,
      toolTokenStats,
      effectiveness: {
        cacheHitRate,
        efficiencyRatio,
        tokensPerToolCall,
        toolSuccessRate,
        costPerFile,
        totalTokens,
        totalToolCalls,
      },
    };
  }, [messages, session]);
}
