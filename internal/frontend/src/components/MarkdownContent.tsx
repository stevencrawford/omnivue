import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeHighlight from "rehype-highlight";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`markdown-body markdown-body--small ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Render code blocks with proper styling
          pre({ children }) {
            return (
              <pre className="rounded-md bg-gh-bg-secondary border border-gh-border p-3 overflow-x-auto text-xs leading-relaxed">
                {children}
              </pre>
            );
          },
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-gh-bg-secondary border border-gh-border text-[0.85em] font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={`${className ?? ""} text-xs`} {...props}>
                {children}
              </code>
            );
          },
          // Links open in new tab
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          },
          // Tables
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="border-collapse border border-gh-border text-xs w-full">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-gh-border px-3 py-1.5 bg-gh-bg-secondary font-semibold text-left">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-gh-border px-3 py-1.5">
                {children}
              </td>
            );
          },
          // Blockquote
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-gh-border pl-4 my-2 text-gh-text-secondary italic">
                {children}
              </blockquote>
            );
          },
          // Headings
          h1({ children }) {
            return <h1 className="text-lg font-bold mt-4 mb-2 pb-1 border-b border-gh-border">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-bold mt-3 mb-2 pb-1 border-b border-gh-border">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mt-3 mb-1">{children}</h3>;
          },
          // Lists
          ul({ children }) {
            return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>;
          },
          // Paragraphs
          p({ children }) {
            return <p className="my-1.5 leading-relaxed">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
