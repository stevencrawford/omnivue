import { useCallback, useEffect, useState } from "react";
import { Effect } from "effect";
import { RecentSearchService } from "../services";
import { runPromise } from "../lib/effect";

const MAX_SEARCHES = 10;

export function useRecentSearches() {
  const [searches, setSearches] = useState<string[]>([]);

  useEffect(() => {
    runPromise(
      RecentSearchService.pipe(
        Effect.flatMap((svc) => svc.list()),
        Effect.catchAll(() => Effect.succeed([] as string[])),
      ),
    ).then(setSearches);
  }, []);

  const addSearch = useCallback((query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearches((prev) => {
      const next = [q, ...prev.filter((s) => s !== q)].slice(0, MAX_SEARCHES);
      runPromise(
        RecentSearchService.pipe(
          Effect.flatMap((svc) => svc.add(next)),
          Effect.catchAll(() => Effect.void),
        ),
      );
      return next;
    });
  }, []);

  const clearSearches = useCallback(() => {
    setSearches([]);
    runPromise(
      RecentSearchService.pipe(
        Effect.flatMap((svc) => svc.add([])),
        Effect.catchAll(() => Effect.void),
      ),
    );
  }, []);

  return { recentSearches: searches, addSearch, clearSearches };
}
