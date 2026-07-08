import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import { ApiError } from "./common";

export class ConfigService extends Effect.Service<ConfigService>()("ConfigService", {
  effect: Effect.gen(function* () {
    const fetch = (): Effect.Effect<Record<string, string>, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchConfig(),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/config"),
      });

    const set = (key: string, value: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.setConfig(key, value),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/config"),
      });

    const reset = (): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.resetApp(),
        catch: (e) => new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/reset"),
      });

    return { fetch, set, reset } as const;
  }),
}) {}
