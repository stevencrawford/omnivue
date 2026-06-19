import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Folder, X } from "lucide-react";
import type { SearchResult } from "../hooks/useApi";
import { fetchSearch } from "../hooks/useApi";
import { relativeTime } from "../utils/sessionUtils";
import { renderSnippet } from "../utils/searchUtils";

interface SearchPanelProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSelectSession: (sessionId: string, chunkType: string, query: string) => void;
  onOpenDrawer: (query: string) => void;
  onClose: () => void;
  searchScope: string | null;
  searchScopeName: string | null;
  onClearScope: () => void;
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
  globalStartIndex: number;
};

export function SearchPanel({
  query,
  onQueryChange,
  onSelectSession,
  onOpenDrawer,
  onClose,
  searchScope,
  searchScopeName,
  onClearScope,
}: SearchPanelProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userNavigated = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);

  const sections: Section[] = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const r of results) {
      const ct = r.chunkType || "messages";
      if (!groups.has(ct)) groups.set(ct, []);
      groups.get(ct)!.push(r);
    }
    const order = ["name", "plan", "messages"];
    const out: Section[] = [];
    let globalIdx = 0;
    for (const ct of order) {
      const group = groups.get(ct);
      if (!group || group.length === 0) continue;
      const meta = CHUNK_LABELS[ct] || {
        label: ct,
        badge: "bg-gh-bg-hover text-gh-text-secondary border-gh-border",
      };
      out.push({ chunkType: ct, ...meta, results: group, globalStartIndex: globalIdx });
      globalIdx += group.length;
    }
    return out;
  }, [results]);

  const totalResults = results.length;

  useEffect(() => {
    setHasNavigated(false);
    userNavigated.current = false;
  }, [results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim()) {
      doSearch(query);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data = await fetchSearch(q.trim(), 50, searchScope ?? undefined);
        setResults(data);
      } catch (err) {
        console.error("Search failed:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [searchScope],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onQueryChange(val);
    setSelectedIndex(0);
    userNavigated.current = false;
    setHasNavigated(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      userNavigated.current = true;
      setHasNavigated(true);
      setSelectedIndex((i) => Math.min(i + 1, totalResults - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      userNavigated.current = true;
      setHasNavigated(true);
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      if (userNavigated.current && results[selectedIndex]) {
        onSelectSession(results[selectedIndex].sessionId, results[selectedIndex].chunkType, query);
      } else if (results.length > 0) {
        onOpenDrawer(query);
      }
    }
  };

  const handleClearQuery = () => {
    onQueryChange("");
    setResults([]);
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="search-overlay-backdrop" onClick={onClose} />
      <div className="search-overlay">
        <div className="search-overlay-panel">
          <div className="flex items-center gap-1.5 px-3 py-3 border-b border-gh-border">
            <Search size={16} className="text-accent shrink-0" />
            {searchScope && searchScopeName && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-accent-muted text-accent border border-accent-border shrink-0">
                <Folder size={12} />
                {searchScopeName}
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
              </span>
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={
                searchScope ? "Search in current session..." : "Search sessions, messages, plans..."
              }
              className="flex-1 bg-transparent text-sm text-gh-text placeholder:text-gh-text-secondary outline-none min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearQuery}
                className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5 rounded shrink-0"
              >
                <X size={14} />
              </button>
            )}
            <span className="sess-kbd">Esc</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[50vh]">
            {loading && (
              <div className="flex items-center justify-center gap-2 text-xs text-gh-text-secondary p-6">
                <span className="size-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                Searching...
              </div>
            )}
            {!loading && query && totalResults === 0 && (
              <div className="text-xs text-gh-text-secondary p-6 text-center">No results</div>
            )}
            {!loading &&
              sections.map((section) => (
                <div key={section.chunkType}>
                  <div className="sticky top-0 z-10 bg-gh-bg-secondary/90 backdrop-blur-sm px-3 py-1.5 border-b border-gh-border">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${section.badge}`}
                    >
                      {section.label}
                    </span>
                  </div>
                  {section.results.map((r, i) => {
                    const globalIdx = section.globalStartIndex + i;
                    return (
                      <button
                        key={`${r.sessionId}-${section.chunkType}-${i}`}
                        type="button"
                        className={`w-full text-left px-4 py-3 border-b border-gh-border cursor-pointer transition-colors ${
                          globalIdx === selectedIndex
                            ? "search-result--selected text-gh-text"
                            : "hover:bg-gh-bg-hover text-gh-text-secondary"
                        }`}
                        onClick={() => onSelectSession(r.sessionId, r.chunkType, query)}
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
                    );
                  })}
                </div>
              ))}
            {!loading && !query && (
              <div className="text-xs text-gh-text-secondary p-6 text-center leading-relaxed">
                Search across conversations, tool calls, and plan content
              </div>
            )}
            {!loading && query && totalResults > 0 && !hasNavigated && (
              <div className="sticky bottom-0 px-3 py-2 border-t border-gh-border bg-gh-bg-secondary/80 backdrop-blur-sm text-center">
                <span className="text-[11px] text-gh-text-secondary">
                  Press <span className="sess-kbd mx-0.5">Enter</span> to open results panel
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
