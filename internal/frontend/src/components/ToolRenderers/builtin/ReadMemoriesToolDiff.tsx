import { BrainCircuit } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

function repoFromOutput(output: string): string {
  const m = output.match(/## Repository memories for `([^`]+)`/);
  return m ? m[1] : "";
}

function factCount(output: string): number {
  const m = output.match(/^- Fact:/gm);
  return m ? m.length : 0;
}

export function ReadMemoriesToolDiff({ tool, variant }: ToolRendererProps) {
  const output = tool.output || "";
  const repo = repoFromOutput(output);
  const facts = factCount(output);

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <BrainCircuit size={12} className="text-violet-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">memories:</span>
        <span className="text-ov-text truncate min-w-0">
          {repo ? `${repo} · ${facts} fact${facts === 1 ? "" : "s"}` : "read_memories"}
        </span>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      {output ? (
        <MarkdownContent content={output} className="markdown-body--wide" />
      ) : (
        <p className="text-[12px] text-ov-text-secondary/70">No memories returned.</p>
      )}
    </div>
  );
}
