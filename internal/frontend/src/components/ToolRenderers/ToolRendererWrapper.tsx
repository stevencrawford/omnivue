import { useState } from "react";
import type { ToolRendererDefinition, ToolRendererProps } from "./types";
import type { ToolCall } from "../../hooks/useApi";

const DEFAULT_OUTPUT_MAX_LINES = 200;

function truncateLines(output: string, maxLines: number): { display: string; totalLines: number } {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return { display: output, totalLines: lines.length };
  return {
    display:
      lines.slice(0, maxLines).join("\n") +
      `\n\n... (${lines.length - maxLines} more lines)`,
    totalLines: lines.length,
  };
}

export function ToolRendererWrapper({
  renderer,
  tool,
  compact,
  onOpenModal,
  onPin,
  onCopy,
}: {
  renderer: ToolRendererDefinition;
  tool: ToolCall;
  compact: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onCopy?: (content: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxLines = renderer.truncateOutput ?? DEFAULT_OUTPUT_MAX_LINES;

  const shouldTruncate = !compact && !expanded && maxLines > 0;
  const truncated = shouldTruncate && tool.output
    ? truncateLines(tool.output, maxLines)
    : null;

  const displayTool = truncated
    ? { ...tool, output: truncated.display }
    : tool;

  const props: ToolRendererProps = {
    tool: displayTool,
    compact,
    onOpenModal,
    onPin,
    onCopy,
  };

  return (
    <>
      <renderer.Component {...props} />
      {!compact && truncated && (
        <div className="text-center border-t border-gh-border">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
          >
            {expanded ? "Show less" : `Show more (${truncated.totalLines} lines)`}
          </button>
        </div>
      )}
    </>
  );
}
