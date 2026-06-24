import { useMemo } from "react";
import type { Message } from "./useApi";
import { effectiveToolKind } from "../utils/toolDisplay";

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

const SUMMARY_DEFS: {
  kind: string;
  label: string;
  color: string;
  test: (msg: Message, counted: Set<string>) => boolean;
  toolKinds: string[];
}[] = [
  {
    kind: "user-request",
    label: "User Requests",
    color: "#58a6ff",
    toolKinds: [],
    test: (msg, counted) => {
      if (msg.role !== "user") return false;
      counted.add(msg.id);
      return true;
    },
  },
  {
    kind: "thinking",
    label: "Thinking",
    color: "#a78bfa",
    toolKinds: [],
    test: (msg, counted) => {
      if (msg.role !== "assistant") return false;
      if (!msg.reasoning) return false;
      counted.add(msg.id);
      return true;
    },
  },
  {
    kind: "edit",
    label: "Edits",
    color: "#ef4444",
    toolKinds: ["edit", "write", "delete"],
    test: () => false,
  },
  {
    kind: "read",
    label: "Reads",
    color: "#06b6d4",
    toolKinds: ["read"],
    test: () => false,
  },
  {
    kind: "bash",
    label: "Shell",
    color: "#eab308",
    toolKinds: ["bash"],
    test: () => false,
  },
  {
    kind: "search",
    label: "Search",
    color: "#8b5cf6",
    toolKinds: ["grep", "glob", "codesearch"],
    test: () => false,
  },
  {
    kind: "web",
    label: "Web",
    color: "#ec4899",
    toolKinds: ["webfetch", "websearch"],
    test: () => false,
  },
  {
    kind: "other",
    label: "Other",
    color: "#6b7280",
    toolKinds: [],
    test: () => false,
  },
];

function mapToolKind(kind: string): string {
  if (["edit", "write", "delete"].includes(kind)) return "edit";
  if (kind === "read") return "read";
  if (kind === "bash") return "bash";
  if (["grep", "glob", "codesearch"].includes(kind)) return "search";
  if (["webfetch", "websearch"].includes(kind)) return "web";
  return "other";
}

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
          const kind = mapToolKind(effectiveToolKind(tc));
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
      label: def.label,
      color: def.color,
      count: counts.get(def.kind) ?? 0,
      percentage: totalCount > 0 ? ((counts.get(def.kind) ?? 0) / totalCount) * 100 : 0,
      duration: durations.get(def.kind) ?? 0,
    }));

    return { categories, totalCount, totalDuration, hasTiming };
  }, [messages]);
}
