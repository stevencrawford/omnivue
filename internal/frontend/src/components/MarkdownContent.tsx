import { memo, useMemo, useState } from "react";
import { ChevronRight, Check, Copy, Maximize2, Pin, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { useCopy } from "../hooks/useCopy";
import { useSearchHighlight } from "../hooks/useNav";
import { BookmarkButton } from "./ToolRenderers/BookmarkButton";
import { MarkdownScreenshotButton } from "./MarkdownScreenshotButton";

interface MarkdownContentProps {
  content: string;
  className?: string;
  onOpenModal?: (content: string) => void;
  onPin?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  modalTitle?: string;
  expandable?: boolean;
  defaultExpanded?: boolean;
  searchHighlightQuery?: string;
  hideCopy?: boolean;
}

// Content longer than this is rendered as plain text (with an opt-in "Render as
// markdown" action) instead of being pushed through the synchronous markdown
// pipeline, which would otherwise block the main thread on a single huge part.
const LARGE_CONTENT_LIMIT = 256 * 1024;
// A single code block larger than this is rendered without syntax highlighting.
const CODE_BLOCK_LIMIT = 300 * 1024;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Rehype plugin: wraps matching text in <mark> tags for search highlighting */
function rehypeSearchHighlight(query: string) {
  const q = query.toLowerCase();
  return () => (tree: any) => {
    transform(tree);
    function transform(node: any): any {
      if (!node || typeof node !== "object") return node;
      if (node.type === "text") {
        const lower = (node.value || "").toLowerCase();
        if (!lower.includes(q)) return node;
        const parts: any[] = [];
        let last = 0;
        let idx = lower.indexOf(q);
        while (idx !== -1) {
          if (idx > last) parts.push({ type: "text", value: node.value.slice(last, idx) });
          parts.push({
            type: "element",
            tagName: "mark",
            properties: { className: "search-highlight" },
            children: [{ type: "text", value: node.value.slice(idx, idx + q.length) }],
          });
          last = idx + q.length;
          idx = lower.indexOf(q, last);
        }
        if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
        return parts;
      }
      if (node.children && node.children.length > 0) {
        const newChildren: any[] = [];
        for (const child of node.children) {
          const result = transform(child);
          if (Array.isArray(result)) newChildren.push(...result);
          else newChildren.push(result);
        }
        node.children = newChildren;
      }
      return node;
    }
  };
}

/**
 * Rehype plugin run BEFORE rehype-highlight: strips the language class off any
 * code block larger than `limit` so highlight.js never tokenizes a giant fence
 * (a known main-thread stall source). Runs before highlighting.
 */
function rehypeGuardOversizedCode(limit: number) {
  return () => (tree: any) => {
    function walk(node: any): any {
      if (!node || typeof node !== "object") return node;
      if (node.children && Array.isArray(node.children)) {
        node.children = node.children.map(walk);
      }
      if (node.type !== "element" || node.tagName !== "pre") return node;
      const code = (node.children || []).find(
        (c: any) => c && c.type === "element" && c.tagName === "code",
      );
      if (!code) return node;
      let len = 0;
      const stack: any[] = code.children ? [...code.children] : [];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (cur.type === "text") len += (cur.value || "").length;
        if (cur.children && Array.isArray(cur.children)) stack.push(...cur.children);
      }
      if (len <= limit) return node;
      const cls: unknown[] = Array.isArray(code.properties?.className)
        ? code.properties!.className
        : [];
      code.properties = {
        ...code.properties,
        className: cls.filter((c) => !String(c).startsWith("language-")),
      };
      return node;
    }
    return walk(tree);
  };
}

/** The shared markdown renderer, memoized so a full re-parse only happens when
 * the content or plugin inputs actually change. */
const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  searchHighlightQuery,
}: {
  content: string;
  searchHighlightQuery: string | undefined;
}) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkBreaks], []);
  const rehypePlugins = useMemo(
    () => [
      rehypeGuardOversizedCode(CODE_BLOCK_LIMIT),
      rehypeHighlight,
      ...(searchHighlightQuery ? [rehypeSearchHighlight(searchHighlightQuery)] : []),
    ],
    [searchHighlightQuery],
  );
  const components = useMemo<Components>(
    () => ({
      pre({ children }) {
        return <pre>{children}</pre>;
      },
      code({ className: codeClass, children, ...props }) {
        const isInline = !codeClass;
        if (isInline) {
          return <code {...props}>{children}</code>;
        }
        return (
          <code className={codeClass} {...props}>
            {children}
          </code>
        );
      },
      a({ href, children, ...props }) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
      table({ children }) {
        return (
          <div className="overflow-x-auto">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [],
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});

/** Renders oversized content as collapsed, scrollable plain text with an opt-in
 * action to run the (expensive) markdown pipeline. */
function LargeContent({ content, className }: { content: string; className: string }) {
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  if (renderMarkdown) {
    return (
      <div className={`markdown-body markdown-body--small ${className}`.trim()}>
        <MarkdownRenderer content={content} searchHighlightQuery={undefined} />
      </div>
    );
  }
  return (
    <div className={`markdown-body markdown-body--small ${className}`.trim()}>
      <div className="mb-2 flex items-start gap-2 rounded border border-ov-border bg-surface-elevated px-3 py-2 text-xs text-ov-text-secondary">
        <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0">
          This message is {formatSize(content.length)} of mostly-plain text. It is rendered as plain
          text to keep the UI responsive.
          <button
            type="button"
            className="ml-2 text-accent hover:text-accent-secondary cursor-pointer underline underline-offset-2"
            onClick={() => setRenderMarkdown(true)}
          >
            Render as Markdown
          </button>
        </div>
      </div>
      <pre className="max-h-[24em] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-ov-text-secondary">
        {content}
      </pre>
    </div>
  );
}

function MarkdownContentImpl({
  content,
  className = "",
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
  modalTitle,
  expandable = false,
  defaultExpanded = false,
  searchHighlightQuery: searchHighlightQueryProp,
  hideCopy = false,
}: MarkdownContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { copied, copy } = useCopy(2000);
  const ctxSearchHighlight = useSearchHighlight();
  const searchHighlightQuery =
    searchHighlightQueryProp !== undefined
      ? searchHighlightQueryProp
      : ctxSearchHighlight || undefined;

  const shortContent = content.split("\n").length <= 10;
  const isLarge = content.length > LARGE_CONTENT_LIMIT;

  if (isLarge) {
    return <LargeContent content={content} className={className} />;
  }

  if (expandable) {
    return (
      <div>
        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            title={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>
          {!hideCopy && (
            <>
              <button
                type="button"
                onClick={() => copy(content)}
                className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
                title="Copy"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              </button>
              <MarkdownScreenshotButton
                content={content}
                className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
              />
            </>
          )}
          {onPin && (
            <button
              type="button"
              onClick={() => onPin(content)}
              className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
              title="Pin as scratch note"
            >
              <Pin size={12} />
            </button>
          )}
          {onBookmark && (
            <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} size="sm" />
          )}
          {onOpenModal && !shortContent && (
            <button
              type="button"
              onClick={() => onOpenModal(content)}
              className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
              title="Open in modal"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
        <div className={`relative ${!expanded ? "max-h-[15em] overflow-hidden" : ""}`}>
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-ov-bg-secondary)] to-transparent z-10 pointer-events-none" />
          )}
          <div className={`markdown-body markdown-body--small ${className}`.trim()}>
            <MarkdownRenderer content={content} searchHighlightQuery={searchHighlightQuery} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {!hideCopy && (
          <>
            <button
              type="button"
              onClick={() => copy(content)}
              className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated"
              title="Copy"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            </button>
            <MarkdownScreenshotButton content={content} />
          </>
        )}
        {onPin && (
          <button
            type="button"
            onClick={() => onPin(content)}
            className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated"
            title="Pin as scratch note"
          >
            <Pin size={12} />
          </button>
        )}
        {onBookmark && (
          <BookmarkButton
            isBookmarked={!!isBookmarked}
            onClick={onBookmark}
            className="border border-ov-border bg-surface-elevated"
          />
        )}
        {onOpenModal && !shortContent && (
          <button
            type="button"
            onClick={() => onOpenModal(content)}
            className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated"
            title={modalTitle ? `View ${modalTitle}` : "Open in modal"}
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>
      <div className={`markdown-body markdown-body--small ${className}`.trim()}>
        <MarkdownRenderer content={content} searchHighlightQuery={searchHighlightQuery} />
      </div>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentImpl);
