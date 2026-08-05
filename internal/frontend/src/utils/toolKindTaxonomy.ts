/**
 * Single source of truth for tool-kind display taxonomy (label / color / marker
 * priority) and token chart segment colors. Consumers must not re-declare these
 * values — a color or label change is a single edit here.
 */

export interface ToolKindInfo {
  label: string;
  color: string;
  priority: number;
}

export const TOOL_KIND_TAXONOMY: Record<string, ToolKindInfo> = {
  // Analytic aggregate categories (Overview / Summary charts)
  "user-request": { label: "User Requests", color: "#58a6ff", priority: 1000 },
  thinking: { label: "Thinking", color: "#a78bfa", priority: 1000 },
  edit: { label: "Edits", color: "#ef4444", priority: 20 },
  read: { label: "Reads", color: "#06b6d4", priority: 50 },
  bash: { label: "Shell", color: "#eab308", priority: 60 },
  search: { label: "Search", color: "#8b5cf6", priority: 70 },
  web: { label: "Web", color: "#ec4899", priority: 80 },
  other: { label: "Other", color: "#6b7280", priority: 1000 },

  // Granular renderer kinds (ToolCard markers)
  write: { label: "Edits", color: "#ef4444", priority: 20 },
  delete: { label: "Deletes", color: "#ef4444", priority: 100 },
  grep: { label: "Search", color: "#8b5cf6", priority: 70 },
  glob: { label: "Search", color: "#8b5cf6", priority: 70 },
  codesearch: { label: "Search", color: "#8b5cf6", priority: 70 },
  read_lints: { label: "Lints", color: "#8b5cf6", priority: 75 },
  webfetch: { label: "Web", color: "#ec4899", priority: 80 },
  websearch: { label: "Web", color: "#ec4899", priority: 80 },
  todowrite: { label: "Todo", color: "#f59e0b", priority: 90 },
  sql: { label: "SQL", color: "#38bdf8", priority: 85 },
  task: { label: "Sub-agent", color: "#f472b6", priority: 10 },
  skill: { label: "Skill", color: "#38bdf8", priority: 15 },
  task_complete: { label: "Task complete", color: "#10b981", priority: 0 },
  question: { label: "Questions", color: "#ec4899", priority: 40 },
  exit_plan_mode: { label: "Plans", color: "#f59e0b", priority: 30 },
  model_switch: { label: "Model switch", color: "#3b82f6", priority: 65 },
  compaction: { label: "Compaction", color: "#14b8a6", priority: 5 },
  permission_request: { label: "Permissions", color: "#f59e0b", priority: 35 },
  store_memory: { label: "Memory", color: "#8b5cf6", priority: 15 },
  read_inbox: { label: "Inbox", color: "#8b5cf6", priority: 15 },
  read_memories: { label: "Memories", color: "#8b5cf6", priority: 15 },
};

export type ToolKindSegment = "input" | "output" | "cache" | "reasoning";

export const TOKEN_COLOR_SEGMENTS: Record<ToolKindSegment, string> = {
  input: "var(--color-accent)",
  output: "var(--color-accent-secondary)",
  cache: "color-mix(in srgb, var(--color-accent) 50%, cyan)",
  reasoning: "color-mix(in srgb, var(--color-accent-secondary) 60%, violet)",
};

const FALLBACK_INFO: ToolKindInfo = { label: "Other", color: "#6b7280", priority: 1000 };

/** Lookup tool-kind display info for any known kind, falling back to "Other". */
export function toolKindInfo(kind: string): ToolKindInfo {
  return TOOL_KIND_TAXONOMY[kind] ?? FALLBACK_INFO;
}

/** Maps a granular tool kind to its aggregate analytic category (edit/read/bash/search/web/other). */
const TOOL_KIND_GROUP: Record<string, string> = {
  edit: "edit",
  write: "edit",
  delete: "edit",
  read: "read",
  bash: "bash",
  grep: "search",
  glob: "search",
  codesearch: "search",
  read_lints: "search",
  webfetch: "web",
  websearch: "web",
};

export function aggregateToolKind(kind: string): string {
  return TOOL_KIND_GROUP[kind] ?? "other";
}
