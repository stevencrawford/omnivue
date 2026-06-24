import { useState } from "react";
import { Check, X } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { CopyButton } from "../CopyButton";
import { BookmarkButton } from "./BookmarkButton";

interface BashMetadata {
  output?: string;
  exit?: number;
  description?: string;
  truncated?: boolean;
}

function trimBashOutput(output: string): string {
  const lines = output.split("\n");
  const maxLines = 200;
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines)`;
  }
  return output;
}

export function BashToolDiff({
  tool,
  onBookmark,
  isBookmarked = false,
}: {
  tool: ToolCall;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  let command = "";
  let description = "";
  try {
    const input = JSON.parse(tool.input);
    command = input.command || "";
    description = input.description || "";
  } catch {
    /* ignore */
  }

  let stdout = tool.output || "";
  let exitCode: number | undefined;
  let truncated = false;
  try {
    const meta: BashMetadata = JSON.parse(tool.metadata || "{}");
    if (meta.output && !stdout) stdout = meta.output;
    if (meta.exit != null) exitCode = meta.exit;
    if (meta.truncated) truncated = true;
  } catch {
    /* ignore */
  }

  const success = exitCode == null || exitCode === 0;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3 group">
      <div
        className={`flex items-center gap-2 w-full px-3 py-1.5 ${expanded ? "border-b border-accent-border " : ""}bg-gh-bg-secondary/50 text-[11px] font-mono text-left cursor-pointer hover:bg-gh-bg-hover transition-colors`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`shrink-0 ${success ? "text-emerald-400" : "text-red-400"}`}>
          {success ? <Check size={12} /> : <X size={12} />}
        </span>
        {description && <span className="text-gh-text/70 truncate">{description}</span>}
        <span className="text-gh-text shrink-0 font-mono">$ {command}</span>
        {truncated && <span className="shrink-0 text-gh-text-secondary/60">truncated</span>}
        {onBookmark && (
          <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <BookmarkButton isBookmarked={isBookmarked} onClick={onBookmark} />
          </span>
        )}
      </div>
      {expanded && (
        <>
          <div className="relative group px-3 py-2 bg-gh-bg-secondary/30">
            <CopyButton text={command} className="absolute top-1 right-1 z-10" />
            <pre className="text-[11px] font-mono leading-relaxed text-gh-text whitespace-pre-wrap break-all">
              <span className="text-accent-secondary">$ </span>
              {command}
            </pre>
          </div>
          {stdout && (
            <div className="relative group border-t border-accent-border">
              <CopyButton text={stdout} className="absolute top-1 right-1 z-10" />
              <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-gh-text-secondary whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                {trimBashOutput(stdout)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
