import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "../hooks/useApi";
import { fetchSearch } from "../hooks/useApi";

interface SearchPanelProps {
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
}

export function SearchPanel({ onSelectSession, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchSearch(q.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);
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
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && results[selectedIndex]) {
      onSelectSession(results[selectedIndex].sessionId);
    }
  };

  return (
    <>
      <div className="search-overlay-backdrop" onClick={onClose} />
      <div className="search-overlay">
        <div className="search-overlay-panel">
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gh-border">
            <svg
              className="size-4 text-accent shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Search sessions, messages, plans..."
              className="flex-1 bg-transparent text-sm text-gh-text placeholder:text-gh-text-secondary outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                }}
                className="text-gh-text-secondary hover:text-gh-text cursor-pointer p-0.5 rounded"
              >
                <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
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
            {!loading && query && results.length === 0 && (
              <div className="text-xs text-gh-text-secondary p-6 text-center">No results</div>
            )}
            {!loading &&
              results.map((r, i) => (
                <button
                  key={`${r.sessionId}-${i}`}
                  type="button"
                  className={`w-full text-left px-4 py-3 border-b border-gh-border cursor-pointer transition-colors ${
                    i === selectedIndex
                      ? "search-result--selected text-gh-text"
                      : "hover:bg-gh-bg-hover text-gh-text-secondary"
                  }`}
                  onClick={() => onSelectSession(r.sessionId)}
                >
                  {r.repository && (
                    <div className="text-[10px] font-mono text-gh-text-secondary truncate mb-1">
                      {r.repository}
                    </div>
                  )}
                  <div
                    className="text-xs text-gh-text line-clamp-2 search-result"
                    dangerouslySetInnerHTML={{ __html: r.snippet }}
                  />
                </button>
              ))}
            {!loading && !query && (
              <div className="text-xs text-gh-text-secondary p-6 text-center leading-relaxed">
                Search across conversations, tool calls, and plan content
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
