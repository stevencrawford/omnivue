import type { ToolCall } from "../hooks/useApi";

export type ToolKind =
  | "bash"
  | "edit"
  | "write"
  | "read"
  | "grep"
  | "glob"
  | "delete"
  | "todowrite"
  | "task"
  | "question"
  | "exit_plan_mode"
  | "task_complete"
  | "compaction";

export const toolKindColors: Record<ToolKind, { accent: string; bg: string; border: string }> = {
  bash: { accent: "var(--color-amber-500)", bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.25)" },
  edit: { accent: "var(--color-emerald-500)", bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.25)" },
  write: { accent: "var(--color-emerald-500)", bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.25)" },
  read: { accent: "var(--color-cyan-500)", bg: "rgba(6, 182, 212, 0.08)", border: "rgba(6, 182, 212, 0.25)" },
  grep: { accent: "var(--color-violet-500)", bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.25)" },
  glob: { accent: "var(--color-violet-500)", bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.25)" },
  delete: { accent: "var(--color-red-500)", bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.25)" },
  todowrite: { accent: "var(--color-amber-500)", bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.25)" },
  task: { accent: "var(--color-violet-500)", bg: "rgba(139, 92, 246, 0.08)", border: "rgba(139, 92, 246, 0.25)" },
  question: { accent: "var(--color-orange-500)", bg: "rgba(249, 115, 22, 0.08)", border: "rgba(249, 115, 22, 0.25)" },
  exit_plan_mode: { accent: "var(--color-amber-500)", bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.25)" },
  task_complete: { accent: "var(--color-emerald-500)", bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.25)" },
  compaction: { accent: "var(--color-gray-500)", bg: "rgba(107, 114, 128, 0.08)", border: "rgba(107, 114, 128, 0.25)" },
};

export function getToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (name === "bash" || name === "run" || name === "terminal") return "bash";
  if (name === "edit" || name === "write") return name === "edit" ? "edit" : "write";
  if (name === "read") return "read";
  if (name === "grep" || name === "search") return "grep";
  if (name === "glob" || name === "list") return "glob";
  if (name === "delete") return "delete";
  if (name === "todowrite") return "todowrite";
  if (name === "task") return "task";
  if (name === "question") return "question";
  if (name === "exit_plan_mode") return "exit_plan_mode";
  if (name === "task_complete") return "task_complete";
  if (name === "compaction") return "compaction";
  return "bash";
}

export function getToolColors(toolCall: ToolCall) {
  const kind = getToolKind(toolCall.name);
  return toolKindColors[kind];
}
