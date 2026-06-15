import type { ToolCall } from "../hooks/useApi";

export function extractJSONField(jsonStr: string, field: string): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const val = parsed[field];
    if (typeof val === "string" && val) return val;
    if (typeof val === "number") return String(val);
    return null;
  } catch {
    return null;
  }
}

/** Infer the real tool kind when the harness wraps calls (e.g. OpenCode `build`). */
export function effectiveToolKind(tool: ToolCall): string {
  const input = tool.input;
  if (extractJSONField(input, "command")) return "bash";
  const fp =
    extractJSONField(input, "filePath") ||
    extractJSONField(input, "file_path") ||
    extractJSONField(input, "path");
  if (fp) {
    if (tool.name === "write") return "write";
    if (tool.name === "read") return "read";
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
  if (agent === "opencode") {
    if (tool.name === "task") {
      const desc = extractJSONField(tool.input, "description") || "";
      return `\u{1F4CB} ${desc.slice(0, 80)}`;
    }
    if (tool.name === "todowrite") {
      const content =
        extractJSONField(tool.input, "content") || extractJSONField(tool.input, "text") || "";
      const status = extractJSONField(tool.input, "status") || "pending";
      const check = status === "completed" ? "\u2713" : "\u25CB";
      return `${check} ${content.slice(0, 80)}`;
    }
  }

  if (tool.name === "task_complete") {
    const summary = extractJSONField(tool.input, "summary") || "";
    return `\u2713 task_complete: ${summary.slice(0, 80)}`;
  }

  const kind = effectiveToolKind(tool);
  const input = tool.input;

  if (kind === "edit" || kind === "write" || kind === "read") {
    const fp =
      extractJSONField(input, "filePath") ||
      extractJSONField(input, "file_path") ||
      extractJSONField(input, "path") ||
      "";
    if (fp) {
      const base = fp.split("/").pop() || fp;
      return `${kind}: ${base}`;
    }
  }

  if (kind === "bash" || kind === "command") {
    const cmd = extractJSONField(input, "command") || "";
    if (cmd) return cmd.length > 100 ? cmd.slice(0, 100) + "…" : cmd;
    return "shell";
  }

  if (kind === "search" || kind === "grep") {
    const pattern = extractJSONField(input, "pattern") || extractJSONField(input, "query") || "";
    if (pattern) return pattern.length > 80 ? pattern.slice(0, 80) + "…" : pattern;
    return "search";
  }

  if (tool.name === "tool") {
    const toolName = extractJSONField(input, "name") || "";
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
