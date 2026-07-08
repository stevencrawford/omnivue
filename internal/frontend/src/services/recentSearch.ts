import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import { ApiError, catchToApiError } from "./common";

export class RecentSearchService extends Effect.Service<RecentSearchService>()(
  "RecentSearchService",
  {
    effect: Effect.gen(function* () {
      const list = (): Effect.Effect<string[], ApiError> =>
        Effect.tryPromise({
          try: () => api.fetchRecentSearches(),
          catch: catchToApiError("/_/api/recent-searches"),
        });

      const add = (searches: string[]): Effect.Effect<void, ApiError> =>
        Effect.tryPromise({
          try: () => api.addRecentSearches(searches),
          catch: catchToApiError("/_/api/recent-searches"),
        });

      return { list, add } as const;
    }),
  },
) {}
