import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { ScratchFile } from "../hooks/types";
import { ApiError } from "./common";

export class ScratchService extends Effect.Service<ScratchService>()("ScratchService", {
  effect: Effect.gen(function* () {
    const listAll = (): Effect.Effect<ScratchFile[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchAllScratchFiles(),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/scratch"),
      });

    const listForSession = (sessionId: string): Effect.Effect<ScratchFile[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchScratchFiles(sessionId),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch`,
          ),
      });

    const create = (
      sessionId: string,
      title: string,
      content?: string,
      mode?: "writable" | "readonly",
    ): Effect.Effect<ScratchFile, ApiError> =>
      Effect.tryPromise({
        try: () => api.createScratchFile(sessionId, title, content, mode),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch`,
          ),
      });

    const get = (sessionId: string, fileId: string): Effect.Effect<ScratchFile, ApiError> =>
      Effect.tryPromise({
        try: () => api.getScratchFile(sessionId, fileId),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch/${fileId}`,
          ),
      });

    const update = (
      sessionId: string,
      fileId: string,
      title: string,
      content: string,
    ): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.updateScratchFile(sessionId, fileId, title, content),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch/${fileId}`,
          ),
      });

    const rename = (
      sessionId: string,
      fileId: string,
      newTitle: string,
    ): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.renameScratchFile(sessionId, fileId, newTitle),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch/${fileId}`,
          ),
      });

    const remove = (sessionId: string, fileId: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.deleteScratchFile(sessionId, fileId),
        catch: (e) =>
          new ApiError(
            String(e),
            e instanceof Response ? e.status : 0,
            `/_/api/sessions/${sessionId}/scratch/${fileId}`,
          ),
      });

    return {
      listAll,
      listForSession,
      create,
      get,
      update,
      rename,
      remove,
    } as const;
  }),
}) {}
