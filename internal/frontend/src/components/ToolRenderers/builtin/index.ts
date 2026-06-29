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
    names: ["bash", "run_terminal_command_v2"],
    Component: BashToolDiff,
    summary: (tool) => cmd(tool),
    markerColor: "#eab308",
    markerLabel: "Shell",
    markerDisplayType: "bash",
    markerPriority: 60,
    truncateOutput: 50,
  },
  {
    kind: "edit",
    names: ["edit", "edit_file_v2"],
    Component: EditToolDiff,
    summary: (tool) => `edit: ${fp(tool)}`,
    markerColor: "#ef4444",
    markerLabel: "Edits",
    markerDisplayType: "edit",
    markerPriority: 20,
    truncateOutput: 0,
    defaultExpanded: true,
  },
  {
    kind: "write",
    names: ["write", "create"],
    Component: EditToolDiff,
    summary: (tool) => `write: ${fp(tool)}`,
    markerColor: "#ef4444",
    markerLabel: "Edits",
    markerDisplayType: "edit",
    markerPriority: 20,
    truncateOutput: 0,
    defaultExpanded: true,
  },
  {
    kind: "read",
    names: ["read", "view", "read_file_v2"],
    Component: ReadToolDiff,
    summary: (tool) => `read: ${fp(tool)}`,
    markerColor: "#06b6d4",
    markerLabel: "Reads",
    markerDisplayType: "read",
    markerPriority: 50,
  },
  {
    kind: "grep",
    names: ["grep", "ripgrep_raw_search"],
    Component: GrepToolDiff,
    summary: (tool) => `grep: ${pattern(tool)}`,
    markerColor: "#8b5cf6",
    markerLabel: "Search",
    markerDisplayType: "search",
    markerPriority: 70,
    truncateOutput: 50,
  },
  {
    kind: "glob",
    names: ["glob", "glob_file_search"],
    Component: GlobToolDiff,
    summary: (tool) => {
      const p = extractJSONField(tool.input, "pattern") || "";
      if (p) return `glob: ${p.length > 60 ? p.slice(0, 60) + "…" : p}`;
      return "glob";
    },
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
    markerColor: "#8b5cf6",
    markerLabel: "Search",
    markerDisplayType: "search",
    markerPriority: 70,
  },
  {
    kind: "delete",
    names: ["delete", "delete_file"],
    Component: DeleteToolDiff,
    summary: (tool) => `delete: ${fp(tool)}`,
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
    markerColor: "#f59e0b",
    markerLabel: "Todo",
    markerDisplayType: "todowrite",
    markerPriority: 90,
    defaultExpanded: true,
  },
  {
    kind: "task",
    names: ["task"],
    Component: TaskToolDiff,
    summary: (tool) => {
      const desc = extractJSONField(tool.input, "description") || "";
      return `\u{1F4CB} ${desc.slice(0, 80)}`;
    },
    markerColor: "#f472b6",
    markerLabel: "Sub-agent",
    markerDisplayType: "sub-agent",
    markerPriority: 10,
    canExpand: true,
  },
  {
    kind: "task_complete",
    names: ["task_complete"],
    Component: TaskCompleteToolDiff,
    summary: (tool) => {
      const s = extractJSONField(tool.input, "summary") || "";
      return `\u2713 task_complete: ${s.slice(0, 80)}`;
    },
    markerColor: "#10b981",
    markerLabel: "Task complete",
    markerDisplayType: "task-complete",
    markerPriority: 0,
  },
  {
    kind: "question",
    names: ["question"],
    Component: QuestionToolDiff,
    summary: (tool) => firstQuestion(tool),
    markerColor: "#f97316",
    markerLabel: "Questions",
    markerDisplayType: "question",
    markerPriority: 40,
    defaultExpanded: true,
  },
  {
    kind: "exit_plan_mode",
    names: ["exit_plan_mode"],
    Component: ExitPlanModeToolDiff,
    summary: () => "plan",
    markerColor: "#a855f7",
    markerLabel: "Plans",
    markerDisplayType: "plan",
    markerPriority: 30,
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
    markerColor: "#6b7280",
    markerLabel: "Compaction",
    markerDisplayType: "compaction",
    markerPriority: 110,
    truncateOutput: 0,
    canExpand: false,
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
    markerColor: "#ec4899",
    markerLabel: "Web",
    markerDisplayType: "web",
    markerPriority: 80,
  },
];
