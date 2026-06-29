import { useState, useMemo } from "react";
import { ChevronRight, Check, Copy, ArrowRight, Circle } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { useSessionNav } from "../../hooks/useNav";
import { useCopy } from "../../hooks/useCopy";
import { toolRendererRegistry } from "./registry";
import { ToolRendererWrapper } from "./ToolRendererWrapper";

const TOOL_CALL_VISIBLE_CAP = 5;

export function ToolCallList({
  toolCalls,
  agent,
  compact = false,
  onOpenModal,
  onPin,
  onBookmark,
  bookmarkIdByRef,
  sessionId,
  messageIndex,
}: {
  toolCalls: ToolCall[];
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (toolCallId: string, label: string) => void;
  bookmarkIdByRef?: Record<string, string>;
  sessionId?: string;
  messageIndex?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const capped = toolCalls.length > TOOL_CALL_VISIBLE_CAP;
  const visible = capped && !showAll ? toolCalls.slice(0, TOOL_CALL_VISIBLE_CAP) : toolCalls;
  const hiddenCount = toolCalls.length - visible.length;

  const toolBookmarkIds = useMemo(() => {
    if (!bookmarkIdByRef || !sessionId || messageIndex === undefined) return new Set<string>();
    const ids = new Set<string>();
    for (const tool of toolCalls) {
      const key = `${sessionId}:${messageIndex}:${tool.id}`;
      if (bookmarkIdByRef[key]) ids.add(tool.id);
    }
    return ids;
  }, [bookmarkIdByRef, sessionId, messageIndex, toolCalls]);

  if (compact) {
    return (
      <>
        {visible.map((tool) => (
          <ToolCallRow
            key={tool.id}
            tool={tool}
            agent={agent}
            compact
            onOpenModal={onOpenModal}
            onPin={onPin}
            onBookmark={onBookmark}
            isBookmarked={toolBookmarkIds.has(tool.id)}
          />
        ))}
        {capped && (
          <button type="button" className="sess-tool-more" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? "Show fewer"
              : `Show ${hiddenCount} more tool call${hiddenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="space-y-1">
      {toolCalls.map((tool) => (
        <ToolCallRow key={tool.id} tool={tool} agent={agent} onOpenModal={onOpenModal} onBookmark={onBookmark} isBookmarked={toolBookmarkIds.has(tool.id)} />
      ))}
    </div>
  );
}

function NonCompactCopyBtn({ tool }: { tool: ToolCall }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(tool.output || "");
      }}
      className="shrink-0 px-2 py-1.5 text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
      title="Copy"
    >
      <Copy size={12} />
    </button>
  );
}

export function ToolCallRow({
  tool,
  agent,
  compact = false,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
}: {
  tool: ToolCall;
  agent?: string;
  compact?: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (toolCallId: string, label: string) => void;
  isBookmarked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { navigateToSession } = useSessionNav();
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool, agent);

  const renderer = toolRendererRegistry.getRenderer(kind);
  const isTask = kind === "task";
  const isTaskComplete = kind === "task_complete";

  const bmOnClick = onBookmark
    ? () => {
        onBookmark(tool.id, summary);
      }
    : undefined;

  if (compact) {
    if (renderer) {
      return (
        <ToolRendererWrapper
          renderer={renderer}
          tool={tool}
          compact
          onOpenModal={onOpenModal}
          onPin={onPin}
          onBookmark={bmOnClick}
          isBookmarked={isBookmarked}
        />
      );
    }
    // Fallback: plain summary line
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="text-gh-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="text-gh-text truncate min-w-0">{summary}</span>
      </div>
    );
  }

  // Non-compact: task_complete doesn't use the expandable wrapper
  if (isTaskComplete && renderer) {
    return (
      <ToolRendererWrapper
        renderer={renderer}
        tool={tool}
        compact={false}
        onOpenModal={onOpenModal}
        onPin={onPin}
        onBookmark={bmOnClick}
        isBookmarked={isBookmarked}
      />
    );
  }

  let childSessionId: string | null = null;
  if (kind === "task" && tool.metadata) {
    try {
      const meta = JSON.parse(tool.metadata);
      childSessionId = meta.sessionId || null;
    } catch {
      /* ignore */
    }
  }

  const completed = tool.status === "completed";
  const statusColor = completed ? "text-emerald-400" : "text-amber-400";
  const wrapperClass = isTask
    ? "border border-violet-500/30 rounded-lg overflow-hidden mb-3 bg-violet-500/[0.03]"
    : "border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center w-full">
        <button type="button" className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors" onClick={() => setExpanded(!expanded)}>
          <ChevronRight
            size={12}
            className={`text-gh-text-secondary transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
          <span className={`text-[11px] ${statusColor} font-bold shrink-0`}>
            {completed ? (
              <Check size={11} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={11} className="text-gh-text-secondary/40 shrink-0" />
            )}
          </span>
          <span
            className={`font-mono text-[11px] truncate flex-1 min-w-0 ${isTask ? "text-violet-300" : "text-gh-text"}`}
          >
            {summary}
          </span>
          {tool.duration && tool.duration > 0 ? (
            <span className="text-[11px] text-gh-text-secondary shrink-0">
              {tool.duration < 1000
                ? `${tool.duration}ms`
                : `${(tool.duration / 1000).toFixed(1)}s`}
            </span>
          ) : null}
        </button>
        <NonCompactCopyBtn tool={tool} />
        {isTask && childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId);
            }}
          >
            <ArrowRight size={12} className="inline" /> View
          </button>
        )}
      </div>
      {expanded && (
        <div
          className={`border-t ${isTask ? "border-violet-500/20" : "border-gh-border"} px-3 py-2 space-y-2 bg-gh-bg-secondary/50`}
        >
          {renderer ? (
            <ToolRendererWrapper
              renderer={renderer}
              tool={tool}
              compact={false}
              onOpenModal={onOpenModal}
              onPin={onPin}
              onBookmark={bmOnClick}
              isBookmarked={isBookmarked}
            />
          ) : (
            <>
              {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
              {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToolDataBlock({ label, content }: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopy(2000);
  const isLong = content.length > 500;
  const displayContent = !expanded && isLong ? content.slice(0, 500) + "..." : content;

  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted =
        !expanded && isLong
          ? JSON.stringify(parsed, null, 2).slice(0, 500) + "..."
          : JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-gh-text-secondary uppercase">{label}</span>
        {isLong && (
          <span className="text-[10px] text-gh-text-secondary/60">
            (
            {content.length > 1024
              ? `${(content.length / 1024).toFixed(1)}kb`
              : `${content.length}b`}
            )
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => copy(content)}
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-gh-bg rounded-md border border-gh-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-gh-text">
        {formatted}
      </pre>
    </div>
  );
}
