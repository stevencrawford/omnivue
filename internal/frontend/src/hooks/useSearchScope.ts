import { useCallback, useMemo, useState } from "react";
import type { Session, SearchResult } from "./useApi";
import { fetchSearch } from "./useApi";

export function useSearchScope(sessions: Session[]) {
  const [searchSessionScope, setSearchSessionScope] = useState<string | null>(null);

  const searchScopeName = useMemo(() => {
    if (!searchSessionScope) return null;
    const s = sessions.find((s) => s.id === searchSessionScope);
    return s?.title || s?.repository || null;
  }, [sessions, searchSessionScope]);

  const clearScope = useCallback(() => {
    setSearchSessionScope(null);
  }, []);

  const scopedSearch = useCallback(
    async (q: string, limit = 100): Promise<SearchResult[]> => {
      try {
        return await fetchSearch(q.trim(), limit, searchSessionScope ?? undefined);
      } catch {
        return [];
      }
    },
    [searchSessionScope],
  );

  return {
    searchSessionScope,
    setSearchSessionScope,
    searchScopeName,
    clearScope,
    scopedSearch,
  };
}
