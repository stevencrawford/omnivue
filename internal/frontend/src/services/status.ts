import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { StatusInfo } from "../hooks/types";
import { ApiError } from "./common";

export class StatusService extends Effect.Service<StatusService>()("StatusService", {
  effect: Effect.gen(function* () {
    const fetch = (): Effect.Effect<StatusInfo, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchStatus(),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/status"),
      });

    return { fetch } as const;
  }),
}) {}
