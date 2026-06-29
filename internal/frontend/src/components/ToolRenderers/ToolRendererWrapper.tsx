import { useState, useMemo } from "react";
import { ChevronDown, Copy, Check, ArrowRight } from "lucide-react";
import type { ToolRendererDefinition, ToolRendererProps } from "./types";
import type { ToolCall } from "../../hooks/useApi";
import { BookmarkButton } from "./BookmarkButton";
import { useSessionNav } from "../../hooks/useNav";

const DEFAULT_OUTPUT_MAX_LINES = 50;

function truncateLines(
  output: string,
  maxLines: number,
): { display: string; totalLines: number } | null {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return null;
  return {
    display:
      lines.slice(0, maxLines).join("\n") + `\n\n... (${lines.length - maxLines} more lines)`,
    totalLines: lines.length,
  };
}

function CopyOutputBtn({ tool }: { tool: ToolCall }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(tool.output || "");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="size-5 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors shrink-0"
      title="Copy output"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

export function ToolRendererWrapper({
  renderer,
  tool,
  compact,
  onOpenModal,
  onPin,
  onCopy,
  onBookmark,
  isBookmarked,
}: {
  renderer: ToolRendererDefinition;
  tool: ToolCall;
  compact: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onCopy?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}) {
  const { navigateToSession } = useSessionNav();

  const childSessionId = useMemo(() => {
    if (!tool.metadata) return null;
    try {
      const meta = JSON.parse(tool.metadata);
      return meta.sessionId || null;
    } catch {
      return null;
    }
  }, [tool.metadata]);

  const canExpand = renderer.canExpand !== false;
  const [expanded, setExpanded] = useState(renderer.defaultExpanded ?? false);
  const [truncExpanded, setTruncExpanded] = useState(false);
  const maxLines = renderer.truncateOutput ?? DEFAULT_OUTPUT_MAX_LINES;

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) setTruncExpanded(false);
  };

  const rendererProps: ToolRendererProps = {
    tool,
    compact,
    onOpenModal,
    onPin,
    onCopy,
    onBookmark,
    isBookmarked,
  };

  if (compact) {
    if (!canExpand) {
      return (
        <div
          className={
            renderer.cardClassName ||
            "border border-gh-border rounded-lg overflow-hidden bg-gh-bg-secondary/50 mb-2"
          }
        >
          <div className="flex items-center w-full">
            <div className="flex-1 min-w-0">
              <renderer.Component {...rendererProps} />
            </div>
            {tool.duration != null && tool.duration > 0 && (
              <span className="text-[10px] font-mono text-gh-text-secondary/40 shrink-0 mr-2.5">
                {tool.duration < 1000
                  ? `${tool.duration}ms`
                  : `${(tool.duration / 1000).toFixed(1)}s`}
              </span>
            )}
            {childSessionId && (
              <button
                type="button"
                className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-gh-bg-hover cursor-pointer transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToSession(childSessionId);
                }}
              >
                <ArrowRight size={12} className="inline" /> View
              </button>
            )}
            <CopyOutputBtn tool={tool} />
            {onBookmark && (
              <BookmarkButton
                isBookmarked={!!isBookmarked}
                onClick={onBookmark}
                size="sm"
                className="mr-1"
              />
            )}
          </div>
        </div>
      );
    }

    const showContent = expanded;
    const shouldTruncate = showContent && !truncExpanded && maxLines > 0;
    const truncated = shouldTruncate && tool.output ? truncateLines(tool.output, maxLines) : null;
    const displayTool = truncated ? { ...tool, output: truncated.display } : tool;

    const expandedRendererProps: ToolRendererProps = {
      tool: displayTool,
      compact: false,
      onOpenModal,
      onPin,
      onCopy,
      onBookmark,
      isBookmarked,
    };

    return (
      <div
        className={
          renderer.cardClassName ||
          "border border-gh-border rounded-lg overflow-hidden bg-gh-bg-secondary/50 mb-2"
        }
      >
        <div className="flex items-center w-full">
          <button
            type="button"
            onClick={handleToggle}
            className="flex items-center flex-1 min-w-0 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors group"
          >
            <ChevronDown
              size={12}
              className={`text-gh-text-secondary/50 shrink-0 ml-2.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
            <div className="flex-1 min-w-0">
              <renderer.Component {...rendererProps} />
            </div>
            {tool.duration != null && tool.duration > 0 && (
              <span className="text-[10px] font-mono text-gh-text-secondary/40 shrink-0 mr-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {tool.duration < 1000
                  ? `${tool.duration}ms`
                  : `${(tool.duration / 1000).toFixed(1)}s`}
              </span>
            )}
          </button>
          {childSessionId && (
            <button
              type="button"
              className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-gh-bg-hover cursor-pointer transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigateToSession(childSessionId);
              }}
            >
              <ArrowRight size={12} className="inline" /> View
            </button>
          )}
          <CopyOutputBtn tool={tool} />
          {onBookmark && (
            <BookmarkButton
              isBookmarked={!!isBookmarked}
              onClick={onBookmark}
              size="sm"
              className="mr-1"
            />
          )}
        </div>
        {showContent && (
          <div className="border-t border-gh-border">
            <renderer.Component {...expandedRendererProps} />
            {truncated && (
              <div className="text-center border-t border-gh-border">
                <button
                  type="button"
                  onClick={() => setTruncExpanded(!truncExpanded)}
                  className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
                >
                  {truncExpanded ? "Show less" : "Show all"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const shouldTruncate = !truncExpanded && maxLines > 0;
  const truncated = shouldTruncate && tool.output ? truncateLines(tool.output, maxLines) : null;
  const displayTool = truncated ? { ...tool, output: truncated.display } : tool;

  return (
    <>
      <renderer.Component {...rendererProps} tool={displayTool} compact={false} />
      {truncated && (
        <div className="text-center border-t border-gh-border">
          <button
            type="button"
            onClick={() => setTruncExpanded(!truncExpanded)}
            className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
          >
            {truncExpanded ? "Show less" : "Show all"}
          </button>
        </div>
      )}
    </>
  );
}
