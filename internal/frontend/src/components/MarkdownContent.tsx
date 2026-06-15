import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";

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
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

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
            <svg
              className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
            title="Copy"
          >
            {copied ? (
              <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
            ) : (
              <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
              </svg>
            )}
          </button>
          {onOpenModal && !shortContent && (
            <button
              type="button"
              onClick={() => onOpenModal(content)}
              className="flex items-center justify-center size-5 rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer transition-colors"
              title="Open in modal"
            >
              <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.75A1.75 1.75 0 0 1 2.75 1h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v3.5a.75.75 0 0 1-1.5 0v-3.5Zm14 0A1.75 1.75 0 0 0 13.25 1h-3.5a.75.75 0 0 0 0 1.5h3.5a.25.25 0 0 1 .25.25v3.5a.75.75 0 0 0 1.5 0v-3.5ZM1 13.25A1.75 1.75 0 0 0 2.75 15h3.5a.75.75 0 0 0 0-1.5h-3.5a.25.25 0 0 1-.25-.25v-3.5a.75.75 0 0 0-1.5 0v3.5Zm14 0A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1 0-1.5h3.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5Z" />
              </svg>
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
      {onOpenModal && !shortContent && (
        <button
          type="button"
          onClick={() => onOpenModal(content)}
          className="absolute top-0 right-0 z-10 flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-gh-border bg-surface-elevated text-gh-text-secondary hover:text-gh-text hover:border-accent-border cursor-pointer transition-all opacity-0 group-hover:opacity-100"
          title={modalTitle ? `View ${modalTitle}` : "Open in modal"}
        >
          <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 2.75A1.75 1.75 0 0 1 2.75 1h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v3.5a.75.75 0 0 1-1.5 0v-3.5Zm14 0A1.75 1.75 0 0 0 13.25 1h-3.5a.75.75 0 0 0 0 1.5h3.5a.25.25 0 0 1 .25.25v3.5a.75.75 0 0 0 1.5 0v-3.5ZM1 13.25A1.75 1.75 0 0 0 2.75 15h3.5a.75.75 0 0 0 0-1.5h-3.5a.25.25 0 0 1-.25-.25v-3.5a.75.75 0 0 0-1.5 0v3.5Zm14 0A1.75 1.75 0 0 1 13.25 15h-3.5a.75.75 0 0 1 0-1.5h3.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5Z" />
          </svg>
          <span>Open in modal</span>
        </button>
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
  );
}
