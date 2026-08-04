import { useCallback, useEffect, useState } from "react";
import { fetchRecentSearches, addRecentSearches } from "./apiClient";
import { runCatching } from "../utils/errors";

const MAX_SEARCHES = 10;

export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>([]);

  useEffect(() => {
    runCatching(() => fetchRecentSearches()).then((data) => setSearches(data ?? []));
  }, []);

  const addSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) return;
      const next = [q, ...searches.filter((s) => s !== q)].slice(0, MAX_SEARCHES);
      setSearches(next);
      runCatching(() => addRecentSearches(next));
    },
    [searches],
  );

  const clearSearches = useCallback(() => {
    setSearches([]);
    runCatching(() => addRecentSearches([]));
  }, []);

  return { recentSearches: searches, addSearch, clearSearches };
}
