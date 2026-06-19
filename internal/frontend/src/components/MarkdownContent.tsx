import { useState } from "react";
import { ChevronRight, Check, Copy, Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";
import { useCopy } from "../hooks/useCopy";

interface MarkdownContentProps {
  content: string;
  className?: string;
  onOpenModal?: (content: string) => void;
  modalTitle?: string;
  expandable?: boolean;
  defaultExpanded?: boolean;
}

export function MarkdownContent({
  content,
  className = "",
  onOpenModal,
  modalTitle,
  expandable = false,
  defaultExpanded = false,
}: MarkdownContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { copied, copy } = useCopy(2000);

  const shortContent = content.split("\n").length <= 10;

  if (expandable) {
    return (
      <div>
        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
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
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          </button>
          {onOpenModal && !shortContent && (
            <button
              type="button"
              onClick={() => onOpenModal(content)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title="Open in modal"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
        <div className={`relative ${!expanded ? "max-h-[15em] overflow-hidden" : ""}`}>
          {!expanded && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-gh-bg-secondary)] to-transparent z-10 pointer-events-none" />
          )}
          <div className={`markdown-body markdown-ayu markdown-body--small ${className}`.trim()}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[rehypeHighlight]}
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
          className="size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        {onOpenModal && !shortContent && (
          <button
            type="button"
            onClick={() => onOpenModal(content)}
            className="size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated"
            title={modalTitle ? `View ${modalTitle}` : "Open in modal"}
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>
      <div className={`markdown-body markdown-ayu markdown-body--small ${className}`.trim()}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeHighlight]}
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
