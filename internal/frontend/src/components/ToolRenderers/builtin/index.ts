import type { ToolRendererDefinition } from "../types";
import type { ToolCall } from "../../../hooks/useApi";
import { extractJSONField } from "../../../utils/jsonField";
import { toolKindInfo } from "../../../utils/toolKindTaxonomy";

import { BashToolDiff } from "./BashToolDiff";
import { EditToolDiff, editInputFromTool } from "./EditToolDiff";
import { ReadToolDiff } from "./ReadToolDiff";
import { GrepToolDiff } from "./GrepToolDiff";
import { GlobToolDiff } from "./GlobToolDiff";
import { DeleteToolDiff } from "./DeleteToolDiff";
import { TodoWriteToolDiff } from "./TodoWriteToolDiff";
import { SqlToolDiff } from "./SqlToolDiff";
import { CompactionToolDiff } from "./CompactionToolDiff";
import { ModelSwitchToolDiff } from "./ModelSwitchToolDiff";
import { TaskToolDiff } from "./TaskToolDiff";
import { SkillToolDiff } from "./SkillToolDiff";
import { QuestionToolDiff } from "./QuestionToolDiff";
import { PermissionRequestToolDiff } from "./PermissionRequestToolDiff";
import { ExitPlanModeToolDiff } from "./ExitPlanModeToolDiff";
import { TaskCompleteToolDiff } from "./TaskCompleteToolDiff";
import { WebFetchToolDiff } from "./WebFetchToolDiff";
import { WebSearchToolDiff } from "./WebSearchToolDiff";
import { StoreMemoryToolDiff } from "./StoreMemoryToolDiff";
import { ReadInboxToolDiff } from "./ReadInboxToolDiff";
import { ReadMemoriesToolDiff } from "./ReadMemoriesToolDiff";
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
    names: ["bash", "run_terminal_command_v2", "run_terminal_command", "read_bash", "stop_bash"],
    Component: BashToolDiff,
    summary: (tool) => cmd(tool),
    display: { type: "expandable" },
    markerColor: toolKindInfo("bash").color,
    markerLabel: toolKindInfo("bash").label,
    markerDisplayType: "bash",
    markerPriority: toolKindInfo("bash").priority,
    truncateOutput: 50,
  },
  {
    kind: "edit",
    names: ["edit", "edit_file_v2", "edit_file", "apply_patch"],
    Component: EditToolDiff,
    summary: (tool) => `edit: ${fp(tool)}`,
    display: { type: "expandable", defaultOpen: true },
    markerColor: toolKindInfo("edit").color,
    markerLabel: toolKindInfo("edit").label,
    markerDisplayType: "edit",
    markerPriority: toolKindInfo("edit").priority,
    truncateOutput: 0,
    copyInput: (tool) => {
      const { newStr, content } = editInputFromTool(tool);
      return newStr || content || "";
    },
  },
  {
    kind: "write",
    names: ["write", "create"],
    Component: EditToolDiff,
    summary: (tool) => `write: ${fp(tool)}`,
    display: { type: "expandable", defaultOpen: true },
    markerColor: toolKindInfo("write").color,
    markerLabel: toolKindInfo("write").label,
    markerDisplayType: "edit",
    markerPriority: toolKindInfo("write").priority,
    truncateOutput: 0,
    copyInput: (tool) => editInputFromTool(tool).content,
    defaultCopyMode: "input",
  },
  {
    kind: "read",
    names: ["read", "view", "read_file_v2", "read_file"],
    Component: ReadToolDiff,
    summary: (tool) => `read: ${fp(tool)}`,
    display: { type: "expandable" },
    markerColor: toolKindInfo("read").color,
    markerLabel: toolKindInfo("read").label,
    markerDisplayType: "read",
    markerPriority: toolKindInfo("read").priority,
  },
  {
    kind: "grep",
    names: ["grep", "ripgrep_raw_search", "grep_search"],
    Component: GrepToolDiff,
    summary: (tool) => `grep: ${pattern(tool)}`,
    display: { type: "expandable" },
    markerColor: toolKindInfo("grep").color,
    markerLabel: toolKindInfo("grep").label,
    markerDisplayType: "search",
    markerPriority: toolKindInfo("grep").priority,
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
    markerColor: toolKindInfo("glob").color,
    markerLabel: toolKindInfo("glob").label,
    markerDisplayType: "search",
    markerPriority: toolKindInfo("glob").priority,
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
    markerColor: toolKindInfo("codesearch").color,
    markerLabel: toolKindInfo("codesearch").label,
    markerDisplayType: "search",
    markerPriority: toolKindInfo("codesearch").priority,
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
    markerColor: toolKindInfo("read_lints").color,
    markerLabel: toolKindInfo("read_lints").label,
    markerDisplayType: "search",
    markerPriority: toolKindInfo("read_lints").priority,
  },
  {
    kind: "delete",
    names: ["delete", "delete_file"],
    Component: DeleteToolDiff,
    summary: (tool) => `delete: ${fp(tool)}`,
    display: { type: "expandable" },
    markerColor: toolKindInfo("delete").color,
    markerLabel: toolKindInfo("delete").label,
    markerDisplayType: "delete",
    markerPriority: toolKindInfo("delete").priority,
  },
  {
    kind: "todowrite",
    names: ["todowrite"],
    Component: TodoWriteToolDiff,
    summary: () => "todowrite",
    display: { type: "expandable", defaultOpen: true },
    markerColor: toolKindInfo("todowrite").color,
    markerLabel: toolKindInfo("todowrite").label,
    markerDisplayType: "todowrite",
    markerPriority: toolKindInfo("todowrite").priority,
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
    markerColor: toolKindInfo("sql").color,
    markerLabel: toolKindInfo("sql").label,
    markerDisplayType: "database",
    markerPriority: toolKindInfo("sql").priority,
  },
  {
    kind: "task",
    names: ["task", "task_v2", "explore:task_v2", "read_agent"],
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
    markerColor: toolKindInfo("task").color,
    markerLabel: toolKindInfo("task").label,
    markerDisplayType: "sub-agent",
    markerPriority: toolKindInfo("task").priority,
    cardClassName:
      "border border-violet-500/30 rounded-lg overflow-hidden bg-violet-500/[0.03] mb-2",
  },
  {
    kind: "skill",
    names: ["skill"],
    Component: SkillToolDiff,
    summary: (tool) => {
      const name =
        extractJSONField(tool.input, "name") || extractJSONField(tool.input, "skill") || "";
      if (name) return `skill: ${name.slice(0, 80)}`;
      const desc = extractJSONField(tool.input, "description") || "";
      if (desc) return `skill: ${desc.slice(0, 80)}`;
      return "skill";
    },
    display: { type: "always-open", renderSummary: true },
    truncateOutput: 0,
    markerColor: toolKindInfo("skill").color,
    markerLabel: toolKindInfo("skill").label,
    markerDisplayType: "skill",
    markerPriority: toolKindInfo("skill").priority,
    cardClassName: "border border-sky-500/30 rounded-lg overflow-hidden bg-sky-500/[0.03] mb-2",
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
    markerColor: toolKindInfo("task_complete").color,
    markerLabel: toolKindInfo("task_complete").label,
    markerDisplayType: "task-complete",
    markerPriority: toolKindInfo("task_complete").priority,
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
    markerColor: toolKindInfo("question").color,
    markerLabel: toolKindInfo("question").label,
    markerDisplayType: "question",
    markerPriority: toolKindInfo("question").priority,
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
    markerColor: toolKindInfo("exit_plan_mode").color,
    markerLabel: toolKindInfo("exit_plan_mode").label,
    markerDisplayType: "plan",
    markerPriority: toolKindInfo("exit_plan_mode").priority,
    truncateOutput: 0,
  },
  {
    kind: "model_switch",
    names: ["model_switch"],
    Component: ModelSwitchToolDiff,
    summary: (tool) => {
      const m = extractJSONField(tool.input, "model") || "";
      const parts = m.split("/");
      return parts.pop() || parts[0] || m || "model";
    },
    display: { type: "always-open" },
    markerColor: toolKindInfo("model_switch").color,
    markerLabel: toolKindInfo("model_switch").label,
    markerDisplayType: "model",
    markerPriority: toolKindInfo("model_switch").priority,
    truncateOutput: 0,
  },
  {
    kind: "compaction",
    names: ["compaction"],
    Component: CompactionToolDiff,
    summary: (tool) => {
      const auto = extractJSONField(tool.input, "auto");
      const kind = extractJSONField(tool.input, "kind") || "";
      const label = kind === "context_compaction" ? "Context compressed" : kind;
      return auto === "true" ? `${label} (auto)` : label;
    },
    display: { type: "always-open" },
    markerColor: toolKindInfo("compaction").color,
    markerLabel: toolKindInfo("compaction").label,
    markerDisplayType: "compaction",
    markerPriority: toolKindInfo("compaction").priority,
    truncateOutput: 0,
  },
  {
    kind: "webfetch",
    names: ["webfetch", "web_fetch"],
    Component: WebFetchToolDiff,
    summary: (tool) => {
      const url = extractJSONField(tool.input, "url") || "";
      if (url) return url.length > 80 ? url.slice(0, 80) + "…" : url;
      return "webfetch";
    },
    display: { type: "expandable" },
    markerColor: toolKindInfo("webfetch").color,
    markerLabel: toolKindInfo("webfetch").label,
    markerDisplayType: "web",
    markerPriority: toolKindInfo("webfetch").priority,
  },
  {
    kind: "websearch",
    names: ["websearch"],
    Component: WebSearchToolDiff,
    summary: (tool) => {
      const q = extractJSONField(tool.input, "query") || "";
      if (q) return q.length > 80 ? q.slice(0, 80) + "…" : q;
      return "websearch";
    },
    display: { type: "expandable" },
    truncateOutput: 0,
    markerColor: toolKindInfo("websearch").color,
    markerLabel: toolKindInfo("websearch").label,
    markerDisplayType: "web",
    markerPriority: toolKindInfo("websearch").priority,
  },
  {
    kind: "permission_request",
    names: ["permission_request"],
    Component: PermissionRequestToolDiff,
    summary: (tool) => {
      const c = extractJSONField(tool.input, "command") || "";
      if (c) return c.length > 80 ? c.slice(0, 80) + "…" : c;
      return "permission_request";
    },
    display: { type: "always-open" },
    markerColor: toolKindInfo("permission_request").color,
    markerLabel: toolKindInfo("permission_request").label,
    markerDisplayType: "permission",
    markerPriority: toolKindInfo("permission_request").priority,
  },
  {
    kind: "store_memory",
    names: ["store_memory"],
    Component: StoreMemoryToolDiff,
    summary: (tool) => {
      const s = extractJSONField(tool.input, "subject") || "";
      return `memory: ${s.slice(0, 80)}`;
    },
    display: { type: "expandable", defaultOpen: true },
    truncateOutput: 0,
    suppressCopy: true,
    markerColor: toolKindInfo("store_memory").color,
    markerLabel: toolKindInfo("store_memory").label,
    markerDisplayType: "memory",
    markerPriority: toolKindInfo("store_memory").priority,
  },
  {
    kind: "read_inbox",
    names: ["read_inbox"],
    Component: ReadInboxToolDiff,
    summary: (tool) => {
      const e = extractJSONField(tool.input, "entry_id") || "";
      return `inbox: ${e.slice(0, 80)}`;
    },
    display: { type: "expandable", defaultOpen: true },
    truncateOutput: 0,
    markerColor: toolKindInfo("read_inbox").color,
    markerLabel: toolKindInfo("read_inbox").label,
    markerDisplayType: "memory",
    markerPriority: toolKindInfo("read_inbox").priority,
  },
  {
    kind: "read_memories",
    names: ["read_memories"],
    Component: ReadMemoriesToolDiff,
    summary: () => "memories",
    display: { type: "expandable", defaultOpen: true },
    truncateOutput: 0,
    markerColor: toolKindInfo("read_memories").color,
    markerLabel: toolKindInfo("read_memories").label,
    markerDisplayType: "memory",
    markerPriority: toolKindInfo("read_memories").priority,
  },
];
