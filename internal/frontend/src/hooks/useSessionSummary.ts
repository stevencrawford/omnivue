import { useMemo } from "react";
import type { Message } from "./types";
import { effectiveToolKind } from "../utils/toolDisplay";
import { aggregateToolKind, toolKindInfo } from "../utils/toolKindTaxonomy";

export interface SummaryCategory {
  kind: string;
  label: string;
  color: string;
  count: number;
  percentage: number;
  duration: number;
}

export interface SessionSummary {
  categories: SummaryCategory[];
  totalCount: number;
  totalDuration: number;
  hasTiming: boolean;
}

interface SummaryDef {
  kind: string;
  test: (msg: Message, counted: Set<string>) => boolean;
}

const SUMMARY_DEFS: SummaryDef[] = [
  {
    kind: "user-request",
    test: (msg, counted) => {
      if (msg.role !== "user") return false;
      counted.add(msg.id);
      return true;
    },
  },
  {
    kind: "thinking",
    test: (msg, counted) => {
      if (msg.role !== "assistant") return false;
      if (!msg.reasoning) return false;
      counted.add(msg.id);
      return true;
    },
  },
  { kind: "edit", test: () => false },
  { kind: "read", test: () => false },
  { kind: "bash", test: () => false },
  { kind: "search", test: () => false },
  { kind: "web", test: () => false },
  { kind: "other", test: () => false },
];

export function useSessionSummary(messages: Message[]): SessionSummary {
  return useMemo(() => {
    const counted = new Set<string>();
    const counts = new Map<string, number>();
    const durations = new Map<string, number>();
    let hasTiming = false;

    for (const kind of SUMMARY_DEFS) {
      counts.set(kind.kind, 0);
      durations.set(kind.kind, 0);
    }

    for (const msg of messages) {
      for (const def of SUMMARY_DEFS) {
        if (def.test(msg, counted)) {
          counts.set(def.kind, (counts.get(def.kind) ?? 0) + 1);
          break;
        }
      }

      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const kind = aggregateToolKind(effectiveToolKind(tc));
          counts.set(kind, (counts.get(kind) ?? 0) + 1);
          if (tc.duration && tc.duration > 0) {
            durations.set(kind, (durations.get(kind) ?? 0) + tc.duration);
            hasTiming = true;
          }
        }
      }
    }

    const totalCount = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    const totalDuration = hasTiming ? Array.from(durations.values()).reduce((a, b) => a + b, 0) : 0;

    const categories: SummaryCategory[] = SUMMARY_DEFS.map((def) => ({
      kind: def.kind,
      label: toolKindInfo(def.kind).label,
      color: toolKindInfo(def.kind).color,
      count: counts.get(def.kind) ?? 0,
      percentage: totalCount > 0 ? ((counts.get(def.kind) ?? 0) / totalCount) * 100 : 0,
      duration: durations.get(def.kind) ?? 0,
    }));

    return { categories, totalCount, totalDuration, hasTiming };
  }, [messages]);
}
