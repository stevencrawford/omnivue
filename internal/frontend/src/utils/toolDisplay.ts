import type { ToolCall } from "../hooks/useApi";
import { toolRendererRegistry } from "../components/ToolRenderers/registry";

export { extractJSONField } from "./jsonField";

/** Infer the real tool kind when the harness wraps calls (e.g. OpenCode `build`). */
export function effectiveToolKind(tool: ToolCall): string {
  return toolRendererRegistry.resolve(tool).kind;
}

export function getToolSummary(tool: ToolCall, agent?: string): string {
  return toolRendererRegistry.resolve(tool, agent).summary;
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
