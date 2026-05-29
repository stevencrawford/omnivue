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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gh-border">
        <svg className="size-4 text-gh-text-secondary shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search sessions..."
          className="flex-1 bg-transparent text-xs text-gh-text placeholder:text-gh-text-secondary outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setResults([]); }}
            className="text-gh-text-secondary hover:text-gh-text cursor-pointer"
          >
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="text-xs text-gh-text-secondary p-3 text-center">Searching...</div>
        )}
        {!loading && query && results.length === 0 && (
          <div className="text-xs text-gh-text-secondary p-3 text-center">No results</div>
        )}
        {!loading && results.map((r, i) => (
          <button
            key={`${r.sessionId}-${i}`}
            type="button"
            className="w-full text-left px-3 py-2 border-b border-gh-border hover:bg-gh-bg-hover cursor-pointer transition-colors"
            onClick={() => onSelectSession(r.sessionId)}
          >
            {r.repository && (
              <div className="text-[10px] text-gh-text-secondary truncate mb-0.5">
                {r.repository}
              </div>
            )}
            <div
              className="text-xs text-gh-text line-clamp-2 [&>mark]:bg-yellow-300/40 [&>mark]:text-gh-text [&>mark]:rounded-sm"
              dangerouslySetInnerHTML={{ __html: r.snippet }}
            />
          </button>
        ))}
        {!loading && !query && (
          <div className="text-xs text-gh-text-secondary p-3 text-center">
            Type to search across all session content
          </div>
        )}
      </div>
    </div>
  );
}
