import { useEffect, useMemo, useRef } from "react";
import { Search, Folder, X } from "lucide-react";
import type { SearchResult } from "../hooks/useApi";
import { relativeTime } from "../utils/sessionUtils";
import { renderSnippet } from "../utils/searchUtils";

interface SearchResultsDrawerProps {
  isOpen: boolean;
  query: string;
  results: SearchResult[];
  onSelect: (sessionId: string, chunkType: string, query: string) => void;
  onClose: () => void;
  searchScopeName?: string | null;
  onClearScope?: () => void;
}

const CHUNK_LABELS: Record<string, { label: string; badge: string }> = {
  name: { label: "Session Name", badge: "bg-accent-muted text-accent border-accent-border" },
  plan: {
    label: "Plan Content",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  messages: {
    label: "Session Messages",
    badge: "bg-gh-bg-hover text-gh-text-secondary border-gh-border",
  },
};

type Section = {
  chunkType: string;
  label: string;
  badge: string;
  results: SearchResult[];
};

export function SearchResultsDrawer({
  isOpen,
  query,
  results,
  onSelect,
  onClose,
  searchScopeName,
  onClearScope,
}: SearchResultsDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [isOpen, query]);

  const sections: Section[] = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
      const ct = r.chunkType || "messages";
      if (!groups.has(ct)) groups.set(ct, []);
      groups.get(ct)!.push(r);
    }
    const order = ["name", "plan", "messages"];
    const out: Section[] = [];
    for (const ct of order) {
      const group = groups.get(ct);
      if (!group || group.length === 0) continue;
      const meta = CHUNK_LABELS[ct] || {
        label: ct,
        badge: "bg-gh-bg-hover text-gh-text-secondary border-gh-border",
      };
      out.push({ chunkType: ct, ...meta, results: group });
    }
    return out;
  }, [results]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-[420px] max-w-[90vw] flex flex-col bg-surface-elevated border-l border-gh-border shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gh-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Search size={16} className="text-accent shrink-0" />
            {searchScopeName && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border shrink-0">
                <Folder size={12} />
                {searchScopeName}
                {onClearScope && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearScope();
                    }}
                    className="ml-0.5 p-0.5 rounded hover:bg-accent/20 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            )}
            <span className="text-sm font-medium text-gh-text truncate">
              {query}
            </span>
            <span className="text-[11px] text-gh-text-secondary tabular-nums shrink-0">
              ({results.length})
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-gh-text-secondary hover:text-gh-text cursor-pointer p-1 rounded transition-colors"
            aria-label="Close search results"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {sections.length === 0 && (
            <div className="text-xs text-gh-text-secondary p-6 text-center">No results found</div>
          )}
          {sections.map((section) => (
            <div key={section.chunkType}>
              <div className="sticky top-0 z-10 bg-gh-bg-secondary/90 backdrop-blur-sm px-3 py-1.5 border-b border-gh-border">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${section.badge}`}
                >
                  {section.label}
                  <span className="tabular-nums opacity-70">({section.results.length})</span>
                </span>
              </div>
              {section.results.map((r, i) => (
                <button
                  key={`${r.sessionId}-${section.chunkType}-${i}`}
                  type="button"
                  className="w-full text-left px-4 py-3 border-b border-gh-border cursor-pointer transition-colors hover:bg-gh-bg-hover text-gh-text-secondary"
                  onClick={() => onSelect(r.sessionId, r.chunkType, query)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {r.chunkType !== "name" && r.sessionName && (
                      <span className="text-[11px] font-semibold text-gh-text truncate">
                        {r.sessionName}
                      </span>
                    )}
                    {r.repository && (
                      <span className="text-[11px] font-mono text-gh-text-secondary truncate">
                        {r.repository}
                      </span>
                    )}
                    {r.updatedAt && (
                      <span className="text-[11px] text-gh-text-secondary shrink-0 ml-auto tabular-nums">
                        {relativeTime(r.updatedAt)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gh-text line-clamp-2 search-result">
                    {renderSnippet(r.snippet)}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
