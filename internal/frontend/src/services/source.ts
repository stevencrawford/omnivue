import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { Source } from "../hooks/types";
import { ApiError } from "./common";

export class SourceService extends Effect.Service<SourceService>()("SourceService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Source[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSources(),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/sources"),
      });

    const add = (
      path: string,
      agentType: string,
      label?: string,
      enabled?: boolean,
    ): Effect.Effect<Source, ApiError> =>
      Effect.tryPromise({
        try: () => api.addSource(path, agentType, label, enabled),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/sources"),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.removeSource(id),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, `/_/api/sources/${id}`),
      });

    const update = (
      id: string,
      data: { path?: string; agentType?: string; label?: string; enabled?: boolean },
    ): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.updateSource(id, data),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, `/_/api/sources/${id}`),
      });

    return { list, add, remove, update } as const;
  }),
}) {}
