import { useState, useMemo } from "react";
import { ChevronRight, Check, Copy, ArrowRight, Circle } from "lucide-react";
import type { ToolCall } from "../../hooks/types";
import type { ToolRendererDefinition } from "./types";
import { effectiveToolKind, getToolSummary } from "../../utils/toolDisplay";
import { useNavigation } from "../../hooks/useNavigation";
import { useCopy } from "../../hooks/useCopy";
import { bookmarkRefKey } from "../../hooks/useBookmarks";
import { toolRendererRegistry } from "./registry";
import { ToolRendererWrapper } from "./ToolRendererWrapper";
import { ToolUsageInfo } from "./ToolUsageInfo";
import { DefaultToolDiff } from "./builtin/DefaultToolDiff";
import { STORAGE_KEYS } from "../../utils/storageKeys";
import { TaskGroupDiff } from "./builtin/TaskGroupDiff";

type GroupedEntry =
  | { kind: "single"; tool: ToolCall }
  | { kind: "task-group"; task: ToolCall; complete: ToolCall };

function coalesceTasks(toolCalls: ToolCall[]): GroupedEntry[] {
  const out: GroupedEntry[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const cur = toolCalls[i];
    const curKind = effectiveToolKind(cur);
    const next = i + 1 < toolCalls.length ? toolCalls[i + 1] : null;
    const nextKind = next ? effectiveToolKind(next) : "";
    if (curKind === "task" && next && nextKind === "task_complete") {
      out.push({ kind: "task-group", task: cur, complete: next });
      i++;
      continue;
    }
    out.push({ kind: "single", tool: cur });
  }
  return out;
}

export function ToolCallList({
  toolCalls,
  agent,
  variant = "summary",
  onOpenModal,
  onPin,
  onBookmark,
  bookmarkIdByRef,
  sessionId,
}: {
  toolCalls: ToolCall[];
  agent?: string;
  variant?: "summary" | "detail";
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (toolCallId: string, label: string) => void;
  bookmarkIdByRef?: Record<string, string>;
  sessionId?: string;
}) {
  const toolBookmarkIds = useMemo(() => {
    if (!bookmarkIdByRef || !sessionId) return new Set<string>();
    const ids = new Set<string>();
    for (const tool of toolCalls) {
      const msgId = tool.messageId || tool.position?.messageID;
      if (!msgId) continue;
      const key = bookmarkRefKey(sessionId, msgId, tool.id);
      if (bookmarkIdByRef[key]) ids.add(tool.id);
    }
    return ids;
  }, [bookmarkIdByRef, sessionId, toolCalls]);

  const grouped = useMemo(() => coalesceTasks(toolCalls), [toolCalls]);

  if (variant === "summary") {
    return (
      <>
        {grouped.map((entry) => {
          if (entry.kind === "task-group") {
            const isBookmarked =
              toolBookmarkIds.has(entry.task.id) ||
              (entry.complete ? toolBookmarkIds.has(entry.complete.id) : false);
            let childSessionId: string | null = null;
            try {
              const meta = JSON.parse(entry.task.metadata || "{}");
              childSessionId = meta.sessionId || null;
            } catch {
              /* ignore */
            }
            let label = "";
            try {
              const p = JSON.parse(entry.task.input);
              label = (p.description || "").slice(0, 80);
            } catch {
              label = entry.task.id.slice(0, 12);
            }
            return (
              <div
                key={`${entry.task.id}:${entry.complete.id}`}
                data-tool-call-id={entry.task.id}
                className="border border-violet-500/30 rounded-lg overflow-hidden bg-violet-500/[0.03] mb-2"
              >
                <TaskGroupDiff
                  task={entry.task}
                  complete={entry.complete}
                  tool={entry.complete || entry.task}
                  variant="summary"
                  onOpenModal={onOpenModal}
                  onPin={onPin}
                  onBookmark={onBookmark ? () => onBookmark(entry.task.id, label) : undefined}
                  isBookmarked={isBookmarked}
                  childSessionId={childSessionId}
                  navigateToSession={undefined}
                />
              </div>
            );
          }
          const tool = entry.tool;
          return (
            <div key={tool.id} data-tool-call-id={tool.id}>
              <ToolCallRow
                tool={tool}
                agent={agent}
                variant="summary"
                onOpenModal={onOpenModal}
                onPin={onPin}
                onBookmark={onBookmark}
                isBookmarked={toolBookmarkIds.has(tool.id)}
              />
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="space-y-1">
      {grouped.map((entry) => {
        if (entry.kind === "task-group") {
          const isBookmarked =
            toolBookmarkIds.has(entry.task.id) ||
            (entry.complete ? toolBookmarkIds.has(entry.complete.id) : false);
          let childSessionId: string | null = null;
          try {
            const meta = JSON.parse(entry.task.metadata || "{}");
            childSessionId = meta.sessionId || null;
          } catch {
            /* ignore */
          }
          let label2 = "";
          try {
            const p2 = JSON.parse(entry.task.input);
            label2 = (p2.description || "").slice(0, 80);
          } catch {
            label2 = entry.task.id.slice(0, 12);
          }
          return (
            <div
              key={`${entry.task.id}:${entry.complete.id}`}
              data-tool-call-id={entry.task.id}
              className="border border-violet-500/30 rounded-lg overflow-hidden bg-violet-500/[0.03] mb-3"
            >
              <TaskGroupDiff
                task={entry.task}
                complete={entry.complete}
                tool={entry.complete || entry.task}
                variant="detail"
                onOpenModal={onOpenModal}
                onPin={onPin}
                onBookmark={onBookmark ? () => onBookmark(entry.task.id, label2) : undefined}
                isBookmarked={isBookmarked}
                childSessionId={childSessionId}
                navigateToSession={undefined}
              />
            </div>
          );
        }
        const tool = entry.tool;
        return (
          <div key={tool.id} data-tool-call-id={tool.id}>
            <ToolCallRow
              tool={tool}
              agent={agent}
              variant="detail"
              onOpenModal={onOpenModal}
              onBookmark={onBookmark}
              isBookmarked={toolBookmarkIds.has(tool.id)}
            />
          </div>
        );
      })}
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
      className="shrink-0 px-2 py-1.5 text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
      title="Copy"
    >
      <Copy size={12} />
    </button>
  );
}

export function ToolCallRow({
  tool,
  agent,
  variant = "summary",
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
}: {
  tool: ToolCall;
  agent?: string;
  variant?: "summary" | "detail";
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: (toolCallId: string, label: string) => void;
  isBookmarked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { navigateToSession } = useNavigation();
  const kind = effectiveToolKind(tool);
  const summary = getToolSummary(tool, agent);

  const disableCustomRenderers = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS) === "true";
    } catch {
      return false;
    }
  })();

  const fallbackRenderer = useMemo<ToolRendererDefinition>(
    () => ({
      kind: "unknown",
      names: [],
      Component: DefaultToolDiff,
      display: { type: "expandable" },
    }),
    [],
  );

  const renderer = !disableCustomRenderers
    ? (toolRendererRegistry.getRenderer(kind) ?? fallbackRenderer)
    : null;
  const isTask = kind === "task";
  const isAlwaysOpen = renderer?.display?.type === "always-open";

  const bmOnClick = onBookmark
    ? () => {
        onBookmark(tool.id, summary);
      }
    : undefined;

  // always-open cards bypass the variant check —
  // those with renderSummary pass through the variant (so they render as a
  // summary line inside the system card with actions), while self-contained
  // cards always render in detail mode.
  if (isAlwaysOpen && renderer) {
    const alwaysOpenVariant =
      renderer.display.type === "always-open" && renderer.display.renderSummary
        ? variant
        : "detail";
    return (
      <ToolRendererWrapper
        renderer={renderer}
        tool={tool}
        variant={alwaysOpenVariant}
        onOpenModal={onOpenModal}
        onPin={onPin}
        onBookmark={bmOnClick}
        isBookmarked={isBookmarked}
      />
    );
  }

  if (variant === "summary") {
    if (renderer) {
      return (
        <ToolRendererWrapper
          renderer={renderer}
          tool={tool}
          variant="summary"
          onOpenModal={onOpenModal}
          onPin={onPin}
          onBookmark={bmOnClick}
          isBookmarked={isBookmarked}
        />
      );
    }
    // When custom renderers are disabled, show an expandable raw data card
    if (disableCustomRenderers) {
      return (
        <div className="border border-ov-border rounded-lg overflow-hidden mb-2 bg-ov-bg-secondary/50">
          <button
            type="button"
            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] font-mono text-left cursor-pointer hover:bg-ov-bg-hover transition-colors"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight
              size={12}
              className={`text-ov-text-secondary transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
            />
            <span className="text-ov-text-secondary/70 font-medium shrink-0">{kind}:</span>
            <span className="text-ov-text truncate min-w-0">{summary}</span>
          </button>
          {open && (
            <div className="border-t border-ov-border px-3 py-2 space-y-2">
              {tool.input && <ToolDataBlock label="Input" content={tool.input} />}
              {tool.output && <ToolDataBlock label="Output" content={tool.output} />}
            </div>
          )}
        </div>
      );
    }
    // Fallback: plain summary line
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <span className="text-ov-text-secondary/70 font-medium shrink-0">{kind}:</span>
        <span className="text-ov-text truncate min-w-0">{summary}</span>
      </div>
    );
  }

  let childSessionId: string | null = null;
  if (tool.metadata) {
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
    : "border border-ov-border rounded-lg overflow-hidden mb-3 bg-ov-bg-secondary/50";

  return (
    <div className={wrapperClass}>
      <div className="flex items-center w-full">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-ov-bg-hover transition-colors"
          onClick={() => setOpen(!open)}
        >
          <ChevronRight
            size={12}
            className={`text-ov-text-secondary transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          />
          <span className={`text-[11px] ${statusColor} font-bold shrink-0`}>
            {completed ? (
              <Check size={11} className="text-emerald-400 shrink-0" />
            ) : (
              <Circle size={11} className="text-ov-text-secondary/40 shrink-0" />
            )}
          </span>
          <span
            className={`font-mono text-[11px] truncate flex-1 min-w-0 ${isTask ? "text-violet-300" : "text-ov-text"}`}
          >
            {summary}
          </span>
        </button>
        {!isTask && <NonCompactCopyBtn tool={tool} />}
        <ToolUsageInfo tool={tool} />
        {childSessionId && (
          <button
            type="button"
            className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 cursor-pointer transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              navigateToSession(childSessionId);
            }}
          >
            <ArrowRight size={12} className="inline" /> View session
          </button>
        )}
      </div>
      {open && (
        <div
          className={`border-t ${isTask ? "border-violet-500/20" : "border-ov-border"} px-3 py-2 space-y-2 bg-ov-bg-secondary/50`}
        >
          {renderer ? (
            <ToolRendererWrapper
              renderer={renderer}
              tool={tool}
              variant="detail"
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
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy(2000);
  const isLong = content.length > 500;
  const displayContent = !open && isLong ? content.slice(0, 500) + "..." : content;

  let formatted = displayContent;
  if (displayContent.startsWith("{") || displayContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(content);
      formatted =
        !open && isLong
          ? JSON.stringify(parsed, null, 2).slice(0, 500) + "..."
          : JSON.stringify(parsed, null, 2);
    } catch {
      // not valid JSON, display as-is
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-ov-text-secondary uppercase">{label}</span>
        {isLong && (
          <span className="text-[10px] text-ov-text-secondary/60">
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
              onClick={() => setOpen(!open)}
              className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
              title={open ? "Collapse" : "Expand"}
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${open ? "rotate-90" : ""}`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => copy(content)}
            className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      <pre className="mt-0.5 p-2 bg-ov-bg rounded-md border border-ov-border overflow-x-auto text-[11px] font-mono max-h-60 overflow-y-auto leading-relaxed text-ov-text">
        {formatted}
      </pre>
    </div>
  );
}
