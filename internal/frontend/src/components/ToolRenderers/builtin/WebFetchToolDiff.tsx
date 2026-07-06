import { ExternalLink } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

export function WebFetchToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let url = "";
  try {
    const parsed = JSON.parse(tool.input);
    url = parsed.url || "";
  } catch {
    /* ignore */
  }

  if (!url) {
    if (variant === "summary") return null;
    return null;
  }

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <ExternalLink size={12} className="text-pink-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">webfetch:</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-ov-text font-semibold truncate min-w-0 hover:text-ov-accent-hover hover:underline"
          title={url}
        >
          {url.length > 80 ? url.slice(0, 80) + "…" : url}
        </a>
      </div>
    );
  }

  const output = tool.output || "";

  return (
    <div className="px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <ExternalLink size={14} className="text-pink-400 shrink-0" />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-ov-text hover:text-ov-accent-hover hover:underline truncate"
          title={url}
        >
          {url}
        </a>
      </div>
      {output && (
        <div className="bg-ov-bg-hover rounded border border-ov-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-ov-border bg-ov-bg/50">
            <span className="text-[10px] font-semibold text-ov-text-secondary uppercase tracking-wider">
              Content
            </span>
          </div>
          <div className="p-2.5 overflow-x-auto max-h-80 overflow-y-auto">
            <MarkdownContent content={output} />
          </div>
        </div>
      )}
    </div>
  );
}
