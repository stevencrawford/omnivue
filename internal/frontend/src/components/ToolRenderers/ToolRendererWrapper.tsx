import { useState, useMemo } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import type { ToolRendererDefinition, ToolRendererProps } from "./types";
import type { ToolCall } from "../../hooks/types";
import ModeAwareCopyButton from "./ModeAwareCopyButton";
import { BookmarkButton } from "./BookmarkButton";
import { ToolUsageInfo } from "./ToolUsageInfo";
import { useNavigation } from "../../hooks/useNavigation";

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

function copyButtonProps(renderer: ToolRendererDefinition, tool: ToolCall) {
  return {
    outputText: tool.output || "",
    inputText: renderer.copyInput ? renderer.copyInput(tool) : undefined,
    defaultMode: renderer.defaultCopyMode ?? "output",
    kind: renderer.kind,
  } as const;
}

export function ToolRendererWrapper({
  renderer,
  tool,
  variant,
  onOpenModal,
  onPin,
  onCopy,
  onBookmark,
  isBookmarked,
}: {
  renderer: ToolRendererDefinition;
  tool: ToolCall;
  variant: "summary" | "detail";
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onCopy?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}) {
  const { navigateToSession } = useNavigation();

  const childSessionId = useMemo(() => {
    if (!tool.metadata) return null;
    try {
      const meta = JSON.parse(tool.metadata);
      return meta.sessionId || null;
    } catch {
      return null;
    }
  }, [tool.metadata]);

  const isExpandable = renderer.display?.type === "expandable";
  const defaultIsOpen =
    renderer.display?.type === "expandable" ? (renderer.display.defaultOpen ?? false) : true;
  const [open, setOpen] = useState(defaultIsOpen);
  const [showFullOutput, setShowFullOutput] = useState(false);
  const maxLines = renderer.truncateOutput ?? DEFAULT_OUTPUT_MAX_LINES;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setShowFullOutput(false);
  };

  const rendererProps: ToolRendererProps = {
    tool,
    rawOutput: tool.output,
    variant,
    onOpenModal,
    onPin,
    onCopy,
    onBookmark,
    isBookmarked,
    childSessionId,
    navigateToSession,
  };

  if (variant === "summary") {
    if (!isExpandable) {
      return (
        <div
          className={
            renderer.cardClassName ||
            "border border-ov-border rounded-lg overflow-hidden bg-ov-bg-secondary/50 mb-2"
          }
        >
          <div className="flex items-center w-full">
            <div className="flex-1 min-w-0">
              <renderer.Component {...rendererProps} />
            </div>
            {childSessionId && (
              <button
                type="button"
                className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-ov-bg-hover cursor-pointer transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToSession(childSessionId);
                }}
              >
                <ArrowRight size={12} className="inline" /> View session
              </button>
            )}
            {!renderer.suppressCopy && <ModeAwareCopyButton {...copyButtonProps(renderer, tool)} />}
            {onBookmark && (
              <BookmarkButton
                isBookmarked={!!isBookmarked}
                onClick={onBookmark}
                size="sm"
                className="mr-1"
              />
            )}
            <ToolUsageInfo tool={tool} />
          </div>
        </div>
      );
    }

    const showContent = open;
    const shouldTruncate = showContent && !showFullOutput && maxLines > 0;
    const truncated = shouldTruncate && tool.output ? truncateLines(tool.output, maxLines) : null;
    const displayTool = truncated ? { ...tool, output: truncated.display } : tool;

    const detailRendererProps: ToolRendererProps = {
      tool: displayTool,
      rawOutput: tool.output,
      variant: "detail",
      onOpenModal,
      onPin,
      onCopy,
      onBookmark,
      isBookmarked,
      childSessionId,
      navigateToSession,
    };

    return (
      <div
        className={
          renderer.cardClassName ||
          "border border-ov-border rounded-lg overflow-hidden bg-ov-bg-secondary/50 mb-2"
        }
      >
        <div className="flex items-center w-full">
          <button
            type="button"
            onClick={handleToggle}
            className="flex items-center flex-1 min-w-0 text-left cursor-pointer hover:bg-ov-bg-hover transition-colors group"
          >
            <ChevronDown
              size={12}
              className={`text-ov-text-secondary/50 shrink-0 ml-2.5 transition-transform ${open ? "" : "-rotate-90"}`}
            />
            <div className="flex-1 min-w-0">
              <renderer.Component {...rendererProps} />
            </div>
          </button>
          {childSessionId && (
            <button
              type="button"
              className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-ov-bg-hover cursor-pointer transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigateToSession(childSessionId);
              }}
            >
              <ArrowRight size={12} className="inline" /> View session
            </button>
          )}
          {!renderer.suppressCopy && <ModeAwareCopyButton {...copyButtonProps(renderer, tool)} />}
          {onBookmark && (
            <BookmarkButton
              isBookmarked={!!isBookmarked}
              onClick={onBookmark}
              size="sm"
              className="mr-1"
            />
          )}
          <ToolUsageInfo tool={tool} />
        </div>
        {showContent && (
          <div className="border-t border-ov-border">
            <renderer.Component {...detailRendererProps} />
            {truncated && (
              <div className="text-center border-t border-ov-border">
                <button
                  type="button"
                  onClick={() => setShowFullOutput(!showFullOutput)}
                  className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
                >
                  {showFullOutput ? "Show less" : "Show all"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const shouldTruncate = !showFullOutput && maxLines > 0;
  const truncated = shouldTruncate && tool.output ? truncateLines(tool.output, maxLines) : null;
  const displayTool = truncated ? { ...tool, output: truncated.display } : tool;

  return (
    <>
      <renderer.Component {...rendererProps} tool={displayTool} variant="detail" />
      {truncated && (
        <div className="text-center border-t border-ov-border">
          <button
            type="button"
            onClick={() => setShowFullOutput(!showFullOutput)}
            className="text-[11px] font-medium text-accent hover:underline py-2 cursor-pointer"
          >
            {showFullOutput ? "Show less" : "Show all"}
          </button>
        </div>
      )}
    </>
  );
}
