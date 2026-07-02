import { Database } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";

export function SqlToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let query = "";
  let description = "";
  try {
    const parsed = JSON.parse(tool.input);
    query = parsed.query || "";
    description = parsed.description || "";
  } catch {
    /* ignore */
  }

  if (!query) return null;

  const truncated = query.length > 200 ? query.slice(0, 200) + "…" : query;

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <Database size={12} className="text-sky-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">sql:</span>
        <span className="text-ov-text truncate min-w-0">{description || truncated}</span>
      </div>
    );
  }

  const output = tool.output || "";

  return (
    <div className="px-3 py-2 space-y-2">
      {description && (
        <div className="text-[11px] text-ov-text-secondary/70 font-medium">{description}</div>
      )}
      <div className="bg-ov-bg-hover rounded border border-ov-border overflow-hidden">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-ov-border bg-ov-bg/50">
          <Database size={11} className="text-sky-400 shrink-0" />
          <span className="text-[10px] font-semibold text-ov-text-secondary uppercase tracking-wider">
            SQL
          </span>
        </div>
        <div className="p-2.5 overflow-x-auto">
          <pre className="text-[11px] leading-relaxed text-ov-text whitespace-pre-wrap font-mono">
            <MarkdownContent content={"```sql\n" + query + "\n```"} />
          </pre>
        </div>
      </div>
      {output && (
        <div className="bg-ov-bg-hover rounded border border-ov-border overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-ov-border bg-ov-bg/50">
            <span className="text-[10px] font-semibold text-ov-text-secondary uppercase tracking-wider">
              Result
            </span>
          </div>
          <div className="p-2.5 overflow-x-auto">
            <pre className="text-[11px] leading-relaxed text-ov-text-secondary whitespace-pre-wrap font-mono">
              {output}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
