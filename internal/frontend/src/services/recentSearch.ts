import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import { ApiError } from "./common";

export class RecentSearchService extends Effect.Service<RecentSearchService>()(
  "RecentSearchService",
  {
    effect: Effect.gen(function* () {
      const list = (): Effect.Effect<string[], ApiError> =>
        Effect.tryPromise({
          try: () => api.fetchRecentSearches(),
          catch: (e) =>
            new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/recent-searches"),
        });

      const add = (searches: string[]): Effect.Effect<void, ApiError> =>
        Effect.tryPromise({
          try: () => api.addRecentSearches(searches),
          catch: (e) =>
            new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/recent-searches"),
        });

      return { list, add } as const;
    }),
  },
) {}
