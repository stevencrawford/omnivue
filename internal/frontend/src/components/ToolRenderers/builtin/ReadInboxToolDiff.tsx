import { Inbox } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

interface ReadInboxInput {
  entry_id?: string;
  entryId?: string;
}

export function ReadInboxToolDiff({ tool, variant }: ToolRendererProps) {
  let input: ReadInboxInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const entryId = input.entry_id || input.entryId || "";
  const output = tool.output || "";

  const entryIdLabel = entryId.split("-").slice(0, 2).join("-") || "inbox";

  let summary = "";
  let content = "";
  if (output) {
    const lines = output.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("summary: ")) {
        summary = lines[i].slice("summary: ".length);
      } else if (
        lines[i].trim() !== "" &&
        !lines[i].startsWith("Inbox entry") &&
        !lines[i].startsWith("entry_id:") &&
        !lines[i].startsWith("sent_at:") &&
        !lines[i].startsWith("summary:")
      ) {
        content = lines.slice(i).join("\n");
        break;
      }
    }
    if (!content) {
      content = output;
    }
  }

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Inbox size={12} className="text-fuchsia-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">inbox:</span>
        <span className="text-ov-text truncate min-w-0">{summary || entryIdLabel}</span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      {entryId && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-ov-text-secondary/70">
          <Inbox size={12} className="text-fuchsia-400 shrink-0" />
          <span className="truncate">{entryId}</span>
        </div>
      )}
      {output && <MarkdownContent content={content || output} className="markdown-body--wide" />}
    </div>
  );
}
