import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { DiscoveredSource, Source } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class SourceService extends Effect.Service<SourceService>()("SourceService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Source[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSources(),
        catch: catchToApiError("/_/api/sources"),
      });

    const add = (
      path: string,
      agentType: string,
      label?: string,
      enabled?: boolean,
    ): Effect.Effect<Source, ApiError> =>
      Effect.tryPromise({
        try: () => api.addSource(path, agentType, label, enabled),
        catch: catchToApiError("/_/api/sources"),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.removeSource(id),
        catch: catchToApiError(`/_/api/sources/${id}`),
      });

    const update = (
      id: string,
      data: { path?: string; agentType?: string; label?: string; enabled?: boolean },
    ): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.updateSource(id, data),
        catch: catchToApiError(`/_/api/sources/${id}`),
      });

    const discover = (): Effect.Effect<DiscoveredSource[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchDiscoveredSources(),
        catch: catchToApiError("/_/api/sources/discover"),
      });

    return { list, add, remove, update, discover } as const;
  }),
}) {}
