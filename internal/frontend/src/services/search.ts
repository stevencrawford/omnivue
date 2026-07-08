import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { SearchResult } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class SearchService extends Effect.Service<SearchService>()("SearchService", {
  effect: Effect.gen(function* () {
    const search = (
      query: string,
      limit = 50,
      sessionId?: string,
      signal?: AbortSignal,
    ): Effect.Effect<SearchResult[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSearch(query, limit, sessionId, signal),
        catch: (e) => {
          if (e instanceof DOMException && e.name === "AbortError") throw e;
          return catchToApiError("/_/api/search")(e);
        },
      });

    return { search } as const;
  }),
}) {}
