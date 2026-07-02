import type { ToolRendererDefinition } from "../types";
import type { ToolCall } from "../../../hooks/useApi";
import { extractJSONField } from "../../../utils/jsonField";

import { BashToolDiff } from "./BashToolDiff";
import { EditToolDiff } from "./EditToolDiff";
import { ReadToolDiff } from "./ReadToolDiff";
import { GrepToolDiff } from "./GrepToolDiff";
import { GlobToolDiff } from "./GlobToolDiff";
import { DeleteToolDiff } from "./DeleteToolDiff";
import { TodoWriteToolDiff } from "./TodoWriteToolDiff";
import { SqlToolDiff } from "./SqlToolDiff";
import { CompactionToolDiff } from "./CompactionToolDiff";
import { TaskToolDiff } from "./TaskToolDiff";
import { QuestionToolDiff } from "./QuestionToolDiff";
import { ExitPlanModeToolDiff } from "./ExitPlanModeToolDiff";
import { TaskCompleteToolDiff } from "./TaskCompleteToolDiff";
import { DefaultToolDiff } from "./DefaultToolDiff";

function fp(tool: ToolCall): string {
  const input = tool.input;
  const f =
    extractJSONField(input, "filePath") ||
    extractJSONField(input, "file_path") ||
    extractJSONField(input, "path") ||
    extractJSONField(input, "relativeWorkspacePath") ||
    "";
  if (f) {
    return f.split("/").pop() || f;
  }
  return "";
}

function cmd(tool: ToolCall): string {
  const c = extractJSONField(tool.input, "command") || "";
  if (c) return c.length > 100 ? c.slice(0, 100) + "…" : c;
  return "shell";
}

function pattern(tool: ToolCall): string {
  const p = extractJSONField(tool.input, "pattern") || extractJSONField(tool.input, "query") || "";
  if (p) return p.length > 80 ? p.slice(0, 80) + "…" : p;
  return "search";
}

function firstQuestion(tool: ToolCall): string {
  const q = extractJSONField(tool.input, "questions");
  if (q) {
    try {
      const parsed = JSON.parse(q);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const t = parsed[0].question || parsed[0].header || "";
        return `? ${t.slice(0, 80)}`;
      }
    } catch {
      /* ignore */
    }
  }
  return "question";
}

export const definitions: ToolRendererDefinition[] = [
  {
    kind: "bash",
    names: ["bash", "run_terminal_command_v2", "run_terminal_command"],
    Component: BashToolDiff,
    summary: (tool) => cmd(tool),
    display: { type: "expandable" },
    markerColor: "#eab308",
    markerLabel: "Shell",
    markerDisplayType: "bash",
    markerPriority: 60,
    truncateOutput: 50,
  },
  {
    kind: "edit",
    names: ["edit", "edit_file_v2", "edit_file", "apply_patch"],
    Component: EditToolDiff,
    summary: (tool) => `edit: ${fp(tool)}`,
    display: { type: "expandable", defaultOpen: true },
    markerColor: "#ef4444",
    markerLabel: "Edits",
    markerDisplayType: "edit",
    markerPriority: 20,
    truncateOutput: 0,
  },
  {
    kind: "write",
    names: ["write", "create"],
    Component: EditToolDiff,
    summary: (tool) => `write: ${fp(tool)}`,
    display: { type: "expandable", defaultOpen: true },
    markerColor: "#ef4444",
    markerLabel: "Edits",
    markerDisplayType: "edit",
    markerPriority: 20,
    truncateOutput: 0,
  },
  {
    kind: "read",
    names: ["read", "view", "read_file_v2", "read_file"],
    Component: ReadToolDiff,
    summary: (tool) => `read: ${fp(tool)}`,
    display: { type: "expandable" },
    markerColor: "#06b6d4",
    markerLabel: "Reads",
    markerDisplayType: "read",
    markerPriority: 50,
  },
  {
    kind: "grep",
    names: ["grep", "ripgrep_raw_search", "grep_search"],
    Component: GrepToolDiff,
    summary: (tool) => `grep: ${pattern(tool)}`,
    display: { type: "expandable" },
    markerColor: "#8b5cf6",
    markerLabel: "Search",
    markerDisplayType: "search",
    markerPriority: 70,
    truncateOutput: 50,
  },
  {
    kind: "glob",
    names: ["glob", "glob_file_search", "list_dir"],
    Component: GlobToolDiff,
    summary: (tool) => {
      const p = extractJSONField(tool.input, "pattern") || "";
      if (p) return `glob: ${p.length > 60 ? p.slice(0, 60) + "…" : p}`;
      return "glob";
    },
    display: { type: "expandable" },
    markerColor: "#8b5cf6",
    markerLabel: "Search",
    markerDisplayType: "search",
    markerPriority: 70,
  },
  {
    kind: "codesearch",
    names: ["codesearch"],
    Component: DefaultToolDiff,
    summary: (tool) => {
      const q = extractJSONField(tool.input, "query") || "";
      if (q) return q.length > 80 ? q.slice(0, 80) + "…" : q;
      return "codesearch";
    },
    display: { type: "expandable" },
    markerColor: "#8b5cf6",
    markerLabel: "Search",
    markerDisplayType: "search",
    markerPriority: 70,
  },
  {
    kind: "read_lints",
    names: ["read_lints"],
    Component: DefaultToolDiff,
    summary: (tool) => {
      const paths = extractJSONField(tool.input, "paths") || "";
      if (paths) {
        try {
          const parsed = JSON.parse(paths);
          if (Array.isArray(parsed)) return `read_lints: ${parsed.length} file(s)`;
        } catch {
          /* ignore */
        }
      }
      return "read_lints";
    },
    display: { type: "expandable" },
    markerColor: "#8b5cf6",
    markerLabel: "Lints",
    markerDisplayType: "search",
    markerPriority: 75,
  },
  {
    kind: "delete",
    names: ["delete", "delete_file"],
    Component: DeleteToolDiff,
    summary: (tool) => `delete: ${fp(tool)}`,
    display: { type: "expandable" },
    markerColor: "#ef4444",
    markerLabel: "Deletes",
    markerDisplayType: "delete",
    markerPriority: 100,
  },
  {
    kind: "todowrite",
    names: ["todowrite"],
    Component: TodoWriteToolDiff,
    summary: () => "todowrite",
    display: { type: "expandable", defaultOpen: true },
    markerColor: "#f59e0b",
    markerLabel: "Todo",
    markerDisplayType: "todowrite",
    markerPriority: 90,
  },
  {
    kind: "sql",
    names: ["sql"],
    Component: SqlToolDiff,
    summary: (tool) => {
      const desc = extractJSONField(tool.input, "description") || "";
      if (desc) return `sql: ${desc.slice(0, 80)}`;
      const q = extractJSONField(tool.input, "query") || "";
      if (q) return `sql: ${q.length > 60 ? q.slice(0, 60) + "…" : q}`;
      return "sql";
    },
    display: { type: "expandable" },
    markerColor: "#38bdf8",
    markerLabel: "SQL",
    markerDisplayType: "database",
    markerPriority: 85,
  },
  {
    kind: "task",
    names: ["task", "task_v2", "explore:task_v2"],
    Component: TaskToolDiff,
    summary: (tool) => {
      const desc = extractJSONField(tool.input, "description") || "";
      const st =
        extractJSONField(tool.input, "subagent_type") ||
        extractJSONField(tool.input, "agent_type") ||
        "";
      if (st) return `📋 ${st} ${desc.slice(0, 76 - st.length)}`;
      return `📋 ${desc.slice(0, 80)}`;
    },
    display: { type: "always-open", renderSummary: true },
    truncateOutput: 0,
    markerColor: "#f472b6",
    markerLabel: "Sub-agent",
    markerDisplayType: "sub-agent",
    markerPriority: 10,
    cardClassName:
      "border border-violet-500/30 rounded-lg overflow-hidden bg-violet-500/[0.03] mb-2",
  },
  {
    kind: "task_complete",
    names: ["task_complete"],
    Component: TaskCompleteToolDiff,
    summary: (tool) => {
      const s = extractJSONField(tool.input, "summary") || "";
      return `✓ ${s.slice(0, 80)}`;
    },
    display: { type: "always-open" },
    markerColor: "#10b981",
    markerLabel: "Task complete",
    markerDisplayType: "task-complete",
    markerPriority: 0,
    truncateOutput: 0,
    cardClassName:
      "border border-emerald-500/30 rounded-lg overflow-hidden bg-emerald-500/[0.04] mb-2",
  },
  {
    kind: "question",
    names: ["question"],
    Component: QuestionToolDiff,
    summary: (tool) => firstQuestion(tool),
    display: { type: "always-open" },
    markerColor: "#f97316",
    markerLabel: "Questions",
    markerDisplayType: "question",
    markerPriority: 40,
  },
  {
    kind: "exit_plan_mode",
    names: ["plan", "exit_plan_mode"],
    Component: ExitPlanModeToolDiff,
    summary: (tool) => {
      const s = extractJSONField(tool.input, "summary") || "";
      return `Plan: ${s.slice(0, 80)}`;
    },
    display: { type: "always-open" },
    markerColor: "#f59e0b",
    markerLabel: "Plans",
    markerDisplayType: "plan",
    markerPriority: 30,
    truncateOutput: 0,
  },
  {
    kind: "compaction",
    names: ["compaction"],
    Component: CompactionToolDiff,
    summary: (tool) => {
      const c = extractJSONField(tool.input, "count") || "";
      const l =
        extractJSONField(tool.input, "label") || extractJSONField(tool.input, "kind") || "items";
      return `${c} ${l}`;
    },
    display: { type: "always-open" },
    markerColor: "#6b7280",
    markerLabel: "Compaction",
    markerDisplayType: "compaction",
    markerPriority: 110,
    truncateOutput: 0,
  },
  {
    kind: "webfetch",
    names: ["webfetch"],
    Component: DefaultToolDiff,
    summary: (tool) => {
      const url = extractJSONField(tool.input, "url") || "";
      if (url) return url.length > 80 ? url.slice(0, 80) + "…" : url;
      return "webfetch";
    },
    display: { type: "expandable" },
    markerColor: "#ec4899",
    markerLabel: "Web",
    markerDisplayType: "web",
    markerPriority: 80,
  },
  {
    kind: "websearch",
    names: ["websearch"],
    Component: DefaultToolDiff,
    summary: (tool) => {
      const q = extractJSONField(tool.input, "query") || "";
      if (q) return q.length > 80 ? q.slice(0, 80) + "…" : q;
      return "websearch";
    },
    display: { type: "expandable" },
    markerColor: "#ec4899",
    markerLabel: "Web",
    markerDisplayType: "web",
    markerPriority: 80,
  },
];
