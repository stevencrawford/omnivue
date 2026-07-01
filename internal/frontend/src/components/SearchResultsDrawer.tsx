import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Folder, X } from "lucide-react";
import type { SearchResult } from "../hooks/useApi";
import { relativeTime } from "../utils/sessionUtils";
import { renderSnippet } from "../utils/searchUtils";

interface SearchResultsDrawerProps {
  isOpen: boolean;
  query: string;
  results: SearchResult[];
  onSelect: (
    sessionId: string,
    chunkType: string,
    query: string,
    fileId?: string,
    messageIndex?: number,
  ) => void;
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
  message: {
    label: "Session Messages",
    badge: "bg-ov-bg-hover text-ov-text-secondary border-ov-border",
  },
  scratch: {
    label: "Scratch Notes",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
};

type Section = {
  chunkType: string;
  label: string;
  badge: string;
  results: SearchResult[];
  globalStartIndex: number;
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sections: Section[] = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
      const ct = r.chunkType === "messages" ? "message" : r.chunkType || "message";
      if (!groups.has(ct)) groups.set(ct, []);
      groups.get(ct)!.push(r);
    }
    const order = ["name", "plan", "message", "scratch"];
    const out: Section[] = [];
    let globalIdx = 0;
    for (const ct of order) {
      const group = groups.get(ct);
      if (!group || group.length === 0) continue;
      const meta = CHUNK_LABELS[ct] || {
        label: ct,
        badge: "bg-ov-bg-hover text-ov-text-secondary border-ov-border",
      };
      out.push({ chunkType: ct, ...meta, results: group, globalStartIndex: globalIdx });
      globalIdx += group.length;
    }
    return out;
  }, [results]);

  const allFlatResults = useMemo(() => {
    return sections.flatMap((s) => s.results);
  }, [sections]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allFlatResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const r = allFlatResults[selectedIndex];
        if (r) {
          onSelect(
            r.sessionId,
            r.chunkType,
            query,
            r.chunkType === "scratch" ? r.fileId : undefined,
            r.messageIndex,
          );
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose, allFlatResults, selectedIndex, onSelect, query]);

  useEffect(() => {
    if (isOpen) {
      scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
  }, [isOpen, query]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 z-50 w-[420px] max-w-[90vw] flex flex-col bg-surface-elevated border-l border-ov-border shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="px-4 py-3 border-b border-ov-border shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Search size={16} className="text-accent shrink-0" />
              <span className="text-sm font-medium text-ov-text truncate">{query}</span>
              <span className="text-[11px] text-ov-text-secondary tabular-nums shrink-0">
                ({results.length})
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-ov-text-secondary hover:text-ov-text cursor-pointer p-1 rounded transition-colors"
              aria-label="Close search results"
            >
              <X size={16} />
            </button>
          </div>
          {searchScopeName && (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border">
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
            </div>
          )}
        </div>

        {/* Results */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {sections.length === 0 && (
            <div className="text-xs text-ov-text-secondary p-6 text-center">No results found</div>
          )}
          {sections.map((section) => (
            <div key={section.chunkType}>
              <div className="sticky top-0 z-10 bg-ov-bg-secondary/90 backdrop-blur-sm px-3 py-1.5 border-b border-ov-border">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${section.badge}`}
                >
                  {section.label}
                  <span className="tabular-nums opacity-70">({section.results.length})</span>
                </span>
              </div>
              {section.results.map((r, i) => {
                const globalIdx = section.globalStartIndex + i;
                return (
                  <button
                    key={`${r.sessionId}-${section.chunkType}-${i}`}
                    type="button"
                    className={`w-full text-left px-4 py-3 border-b border-ov-border cursor-pointer transition-colors ${
                      globalIdx === selectedIndex
                        ? "search-result--selected text-ov-text"
                        : "hover:bg-ov-bg-hover text-ov-text-secondary"
                    }`}
                    onClick={() =>
                      onSelect(
                        r.sessionId,
                        r.chunkType,
                        query,
                        r.chunkType === "scratch" ? r.fileId : undefined,
                        r.messageIndex,
                      )
                    }
                  >
                    <div className="mb-1">
                      <div className="flex items-center gap-2">
                        {r.repository && (
                          <span className="text-[11px] font-mono text-ov-text-secondary truncate">
                            {r.repository}
                          </span>
                        )}
                        {r.updatedAt && (
                          <span className="text-[11px] text-ov-text-secondary shrink-0 ml-auto tabular-nums">
                            {relativeTime(r.updatedAt)}
                          </span>
                        )}
                      </div>
                      {r.sessionName && (
                        <div className="text-[11px] font-semibold text-ov-text truncate leading-snug mt-0.5">
                          {r.sessionName}
                        </div>
                      )}
                      {r.chunkType === "scratch" && r.fileTitle && (
                        <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 truncate leading-snug mt-0.5">
                          {r.fileTitle}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-ov-text line-clamp-2 search-result">
                      {renderSnippet(r.snippet)}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
