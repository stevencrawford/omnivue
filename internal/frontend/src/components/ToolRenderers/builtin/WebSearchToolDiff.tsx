import { Globe } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface SearchResult {
  url: string;
  title: string;
  publish_date: string | null;
  excerpts: string[];
}

interface WebSearchOutput {
  search_id: string;
  results: SearchResult[];
}

function plainTextSnippet(markdown: string, maxLen = 180): string {
  let text = markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/>\s+/gm, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
}

export function WebSearchToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let query = "";
  try {
    const parsed = JSON.parse(tool.input);
    query = parsed.query || "";
  } catch {
    /* ignore */
  }

  let output: WebSearchOutput | null = null;
  try {
    if (tool.output) {
      output = JSON.parse(tool.output);
    }
  } catch {
    /* ignore */
  }

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Globe size={12} className="text-pink-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">websearch:</span>
        <span className="text-ov-text font-semibold truncate min-w-0">
          {query.length > 80 ? query.slice(0, 80) + "…" : query || "websearch"}
        </span>
      </div>
    );
  }

  const results = output?.results || [];

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 pb-1">
        <Globe size={14} className="text-pink-400 shrink-0" />
        <span className="text-[11px] font-semibold text-ov-text">{query}</span>
        <span className="text-[10px] text-ov-text-secondary/50 ml-auto">
          {results.length} result{results.length !== 1 ? "s" : ""}
        </span>
      </div>

      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((result, i) => (
            <div key={i} className="bg-ov-bg-hover rounded border border-ov-border overflow-hidden">
              <div className="px-2.5 py-2 space-y-1">
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-ov-accent hover:underline leading-tight block"
                >
                  {result.title}
                </a>
                <div className="text-[10px] text-ov-text-secondary/40 truncate leading-snug font-mono">
                  {result.url}
                </div>
                {result.excerpts?.length > 0 && (
                  <div className="text-[11px] text-ov-text-secondary leading-relaxed mt-1.5">
                    {plainTextSnippet(result.excerpts[0])}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!output && tool.output && (
        <pre className="text-[11px] font-mono text-ov-text-secondary bg-ov-bg rounded p-2 overflow-x-auto max-h-60 overflow-y-auto">
          {tool.output}
        </pre>
      )}
    </div>
  );
}
