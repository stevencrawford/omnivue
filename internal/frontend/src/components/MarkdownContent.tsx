import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";

interface MarkdownContentProps {
  content: string;
  className?: string;
  onOpenModal?: (content: string) => void;
  modalTitle?: string;
}

export function MarkdownContent({ content, className = "", onOpenModal, modalTitle }: MarkdownContentProps) {
  return (
    <div className="relative group">
      {onOpenModal && (
        <button
          type="button"
          onClick={() => onOpenModal(content)}
          className="absolute top-0 right-0 z-10 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border border-gh-border bg-surface-elevated text-gh-text-secondary hover:text-gh-text hover:border-accent-border cursor-pointer transition-all opacity-0 group-hover:opacity-100"
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
