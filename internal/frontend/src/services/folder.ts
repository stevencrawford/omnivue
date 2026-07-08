import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { Folder } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class FolderService extends Effect.Service<FolderService>()("FolderService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Folder[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchFolders(),
        catch: catchToApiError("/_/api/folders"),
      });

    const create = (name: string, color?: string, icon?: string): Effect.Effect<Folder, ApiError> =>
      Effect.tryPromise({
        try: () => api.createFolder(name, color, icon),
        catch: catchToApiError("/_/api/folders"),
      });

    const update = (
      id: string,
      name: string,
      color?: string,
      icon?: string,
    ): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.updateFolder(id, name, color, icon),
        catch: catchToApiError(`/_/api/folders/${id}`),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.deleteFolder(id),
        catch: catchToApiError(`/_/api/folders/${id}`),
      });

    const listSessions = (folderId: string): Effect.Effect<string[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchFolderSessions(folderId),
        catch: catchToApiError(`/_/api/folders/${folderId}/sessions`),
      });

    const assignSession = (folderId: string, sessionId: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.assignSessionToFolder(folderId, sessionId),
        catch: catchToApiError(`/_/api/folders/${folderId}/sessions/${sessionId}`),
      });

    const unassignSession = (folderId: string, sessionId: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.unassignSessionFromFolder(folderId, sessionId),
        catch: catchToApiError(`/_/api/folders/${folderId}/sessions/${sessionId}`),
      });

    return {
      list,
      create,
      update,
      remove,
      listSessions,
      assignSession,
      unassignSession,
    } as const;
  }),
}) {}
