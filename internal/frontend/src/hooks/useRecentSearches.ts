import { useCallback, useEffect, useState } from "react";
import { fetchRecentSearches, addRecentSearches } from "./useApi";

const MAX_SEARCHES = 10;

export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>([]);

  useEffect(() => {
    fetchRecentSearches()
      .then(setSearches)
      .catch(() => {});
  }, []);

  const addSearch = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearches((prev) => {
      const next = [q, ...prev.filter((s) => s !== q)].slice(0, MAX_SEARCHES);
      addRecentSearches(next).catch(() => {});
      return next;
    });
  }, []);

  const clearSearches = useCallback(() => {
    setSearches([]);
    addRecentSearches([]).catch(() => {});
  }, []);

  return { recentSearches: searches, addSearch, clearSearches };
}
