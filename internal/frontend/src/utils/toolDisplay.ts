import type { ToolCall } from "../hooks/useApi";
import { extractJSONField } from "./jsonField";
import { toolRendererRegistry } from "../components/ToolRenderers/registry";

export { extractJSONField } from "./jsonField";

/** Infer the real tool kind when the harness wraps calls (e.g. OpenCode `build`). */
export function effectiveToolKind(tool: ToolCall): string {
  // Registry check for vendor-defined kinds takes priority
  const fromRegistry = toolRendererRegistry.kindForToolName(tool.name);
  if (fromRegistry) return fromRegistry;

  // Known tool names take priority (works for both OpenCode and Copilot)
  switch (tool.name) {
    case "edit":
    case "write":
    case "read":
    case "bash":
    case "grep":
    case "glob":
    case "todowrite":
    case "task":
    case "task_complete":
    case "question":
    case "webfetch":
    case "websearch":
    case "codesearch":
    case "delete":
    case "jira":
      return tool.name;
    case "view":
      return "read";
    case "create":
      return "write";
    case "edit_file_v2":
    case "edit_file":
    case "apply_patch":
      return "edit";
    case "read_file":
      return "read";
    case "run_terminal_command":
      return "bash";
  }

  const input = tool.input;
  // Field-based guessing for tools with non-standard harness names
  if (extractJSONField(input, "command")) return "bash";
  const fp =
    extractJSONField(input, "filePath") ||
    extractJSONField(input, "file_path") ||
    extractJSONField(input, "path");
  if (fp) {
    if (extractJSONField(input, "offset") || extractJSONField(input, "limit")) return "read";
    return "edit";
  }
  if (extractJSONField(input, "pattern") || extractJSONField(input, "query")) return "grep";
  const inner =
    extractJSONField(input, "tool") ||
    extractJSONField(input, "name") ||
    extractJSONField(input, "type");
  if (inner && inner !== tool.name) return inner;
  return tool.name;
}

export function getToolSummary(tool: ToolCall, agent?: string): string {
  // Registry has per-kind summary functions from renderer definitions
  const fromRegistry = toolRendererRegistry.getSummary(tool, agent);
  if (fromRegistry) return fromRegistry;

  // Fallback for legacy/harness-wrapped cases not covered by registry
  if (agent === "opencode") {
    if (tool.name === "task") {
      const desc = extractJSONField(tool.input, "description") || "";
      return `\u{1F4CB} ${desc.slice(0, 80)}`;
    }
  }

  // Registry has per-kind summary functions from renderer definitions.
  // Most cases below are legacy fallbacks for harness-wrapped tools
  // not yet covered by the registry.
  if (tool.name === "tool") {
    const toolName = extractJSONField(tool.input, "name") || "";
    if (toolName) return toolName;
  }

  // Avoid repeating generic harness labels when we have no better detail
  if (isGenericHarnessLabel(tool.name)) return "tool";
  return tool.name;
}

function isGenericHarnessLabel(name: string): boolean {
  const generic = new Set(["build", "tool", "step", "action", "run", "execute", "invoke"]);
  return generic.has(name.toLowerCase());
}

/** Skip assistant text that only labels an adjacent tool call. */
export function shouldShowStepContent(content: string, toolCalls?: ToolCall[]): boolean {
  const text = content.trim();
  if (!text) return false;

  if (!toolCalls?.length) return true;

  const normalized = text
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .trim();

  for (const tc of toolCalls) {
    if (normalized === tc.name.toLowerCase()) return false;
    if (normalized === effectiveToolKind(tc).toLowerCase()) return false;
  }

  // Single short token (e.g. "build", "read") beside tools
  if (text.length <= 48 && !text.includes("\n") && text.split(/\s+/).length <= 3) {
    if (/^[a-z][\w-]*$/i.test(normalized)) return false;
  }

  return true;
}

export function dedupeConsecutiveLines(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (out.length > 0 && out[out.length - 1] === p) continue;
    out.push(p);
  }
  return out;
}
