import type { ToolCall } from "../hooks/useApi";

export function extractJSONField(jsonStr: string, field: string): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed === null || typeof parsed !== "object") return null;
    const val = (parsed as Record<string, unknown>)[field];
    if (typeof val === "string" && val) return val;
    if (typeof val === "number") return String(val);
    return null;
  } catch {
    return null;
  }
}

/** Infer the real tool kind when the harness wraps calls (e.g. OpenCode `build`). */
export function effectiveToolKind(tool: ToolCall): string {
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
    case "apply_patch":
      return "edit";
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
  if (agent === "opencode") {
    if (tool.name === "task") {
      const desc = extractJSONField(tool.input, "description") || "";
      return `\u{1F4CB} ${desc.slice(0, 80)}`;
    }
  }

  if (tool.name === "task_complete") {
    const summary = extractJSONField(tool.input, "summary") || "";
    return `\u2713 task_complete: ${summary.slice(0, 80)}`;
  }

  const kind = effectiveToolKind(tool);
  const input = tool.input;

  if (kind === "edit" || kind === "write" || kind === "read" || kind === "delete") {
    const fp =
      extractJSONField(input, "filePath") ||
      extractJSONField(input, "file_path") ||
      extractJSONField(input, "path") ||
      extractJSONField(input, "relativeWorkspacePath") ||
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

  if (kind === "grep") {
    const pattern = extractJSONField(input, "pattern") || extractJSONField(input, "query") || "";
    if (pattern) return pattern.length > 80 ? pattern.slice(0, 80) + "…" : pattern;
    return "search";
  }

  if (kind === "glob") {
    const pattern = extractJSONField(input, "pattern") || "";
    if (pattern) return `glob: ${pattern.length > 60 ? pattern.slice(0, 60) + "…" : pattern}`;
    return "glob";
  }

  if (kind === "question") {
    const q = extractJSONField(tool.input, "questions");
    if (q) {
      try {
        const parsed = JSON.parse(q);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const text = parsed[0].question || parsed[0].header || "";
          return `? ${text.slice(0, 80)}`;
        }
      } catch {
        /* ignore */
      }
    }
    return "question";
  }

  if (kind === "todowrite") {
    return "todowrite";
  }

  if (kind === "webfetch") {
    const url = extractJSONField(input, "url") || "";
    if (url) return url.length > 80 ? url.slice(0, 80) + "…" : url;
    return "webfetch";
  }

  if (kind === "websearch") {
    const q = extractJSONField(input, "query") || "";
    if (q) return q.length > 80 ? q.slice(0, 80) + "…" : q;
    return "websearch";
  }

  if (kind === "codesearch") {
    const q = extractJSONField(input, "query") || "";
    if (q) return q.length > 80 ? q.slice(0, 80) + "…" : q;
    return "codesearch";
  }

  if (kind === "jira") {
    let label = "";
    if (tool.output) {
      try {
        const parsed = JSON.parse(tool.output);
        const key = parsed.key || "";
        const summary = parsed.fields?.summary || "";
        if (key && summary) label = `jira: ${key} ${summary.slice(0, 60)}`;
        else if (key) label = `jira: ${key}`;
        else if (summary) label = `jira: ${summary.slice(0, 80)}`;
      } catch {
        /* ignore */
      }
    }
    if (!label) {
      const key =
        extractJSONField(input, "issueIdOrKey") || extractJSONField(input, "issueKey") || "";
      if (key) label = `jira: ${key}`;
    }
    return label.slice(0, 200) || "jira";
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
