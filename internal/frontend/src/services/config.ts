import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import { ApiError, catchToApiError } from "./common";

export class ConfigService extends Effect.Service<ConfigService>()("ConfigService", {
  effect: Effect.gen(function* () {
    const fetch = (): Effect.Effect<Record<string, string>, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchConfig(),
        catch: catchToApiError("/_/api/config"),
      });

    const set = (key: string, value: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.setConfig(key, value),
        catch: catchToApiError("/_/api/config"),
      });

    const reset = (): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.resetApp(),
        catch: catchToApiError("/_/api/reset"),
      });

    return { fetch, set, reset } as const;
  }),
}) {}
