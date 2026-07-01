import { useState } from "react";
import { ChevronRight, Check, Copy, Maximize2, Pin } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { useCopy } from "../hooks/useCopy";
import { useSearchHighlight } from "../hooks/useNav";
import { BookmarkButton } from "./ToolRenderers/BookmarkButton";

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

export function MarkdownContent({
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
}: MarkdownContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { copied, copy } = useCopy(2000);
  const ctxSearchHighlight = useSearchHighlight();
  const searchHighlightQuery =
    searchHighlightQueryProp !== undefined
      ? searchHighlightQueryProp
      : ctxSearchHighlight || undefined;

  const shortContent = content.split("\n").length <= 10;

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
          <button
            type="button"
            onClick={() => copy(content)}
            className="flex items-center justify-center size-5 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
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
          {onBookmark && <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} />}
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[
                rehypeHighlight,
                ...(searchHighlightQuery ? [rehypeSearchHighlight(searchHighlightQuery)] : []),
              ]}
              components={{
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
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="absolute top-0 right-0 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => copy(content)}
          className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
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
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[
            rehypeHighlight,
            ...(searchHighlightQuery ? [rehypeSearchHighlight(searchHighlightQuery)] : []),
          ]}
          components={{
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
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
