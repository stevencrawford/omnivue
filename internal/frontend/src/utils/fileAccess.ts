import type { Message, ToolCall } from "../hooks/types";
import { effectiveToolKind } from "./toolDisplay";
import { extractJSONField } from "./jsonField";

export type FileAccessKind = "read" | "edit" | "write" | "delete";

export interface FileAccess {
  id: string;
  filePath: string;
  kind: FileAccessKind;
  tool: ToolCall;
  messageId: string;
  messageIndex: number;
  timestamp: string;
}

function cleanReadOutput(raw: string): string {
  return raw
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^<path>.*<\/path>\n?/gm, "")
    .replace(/^<type>.*<\/type>\n?/gm, "")
    .replace(/^<content>\n?/gm, "")
    .replace(/\n<\/content>\s*$/gm, "")
    .replace(/^[0-9]{5}\| ?/gm, "");
}

export function filePathFromTool(tool: ToolCall): string {
  return (
    extractJSONField(tool.input, "filePath") ||
    extractJSONField(tool.input, "file_path") ||
    extractJSONField(tool.input, "path") ||
    extractJSONField(tool.input, "relativeWorkspacePath") ||
    ""
  );
}

export function deriveFileAccess(messages: Message[]): FileAccess[] {
  const out: FileAccess[] = [];
  messages.forEach((msg, mi) => {
    for (const tool of msg.toolCalls ?? []) {
      const kind = effectiveToolKind(tool) as FileAccessKind;
      if (kind !== "read" && kind !== "edit" && kind !== "write" && kind !== "delete") continue;
      const fp = filePathFromTool(tool);
      if (!fp) continue;
      out.push({
        id: tool.id,
        filePath: fp,
        kind: kind === "write" ? "write" : kind === "delete" ? "delete" : kind,
        tool,
        messageId: msg.id,
        messageIndex: mi,
        timestamp: msg.timestamp,
      });
    }
  });
  return out;
}

export function readPreviewContent(tool: ToolCall): string {
  return cleanReadOutput(tool.output || "");
}

export function isConsoleTool(tool: ToolCall): boolean {
  const k = effectiveToolKind(tool);
  return k === "bash" || k === "sql";
}

export function isDrawerTool(tool: ToolCall): boolean {
  const k = effectiveToolKind(tool);
  return (
    k === "question" ||
    k === "task_complete" ||
    k === "exit_plan_mode" ||
    k === "task" ||
    k === "skill" ||
    k === "compaction" ||
    k === "permission_request" ||
    k === "store_memory"
  );
}

export function isTreeTool(tool: ToolCall): boolean {
  const k = effectiveToolKind(tool);
  return k === "read" || k === "view" || k === "edit" || k === "write" || k === "delete";
}
