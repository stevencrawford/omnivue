import { useCallback, useEffect, useState } from "react";
import { fetchRecentSearches, addRecentSearches } from "./apiClient";

const MAX_SEARCHES = 10;

export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>([]);

  useEffect(() => {
    fetchRecentSearches()
      .catch(() => [] as string[])
      .then(setSearches);
  }, []);

  const addSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      const next = [q, ...searches.filter((s) => s !== q)].slice(0, MAX_SEARCHES);
      setSearches(next);
      addRecentSearches(next).catch(() => {
        /* ignore */
      });
    },
    [searches],
  );

  const clearSearches = useCallback(() => {
    setSearches([]);
    addRecentSearches([]).catch(() => {
      /* ignore */
    });
  }, []);

  return { recentSearches: searches, addSearch, clearSearches };
}
