import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { Tag } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class TagService extends Effect.Service<TagService>()("TagService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Tag[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchTags(),
        catch: catchToApiError("/_/api/tags"),
      });

    const create = (name: string, color?: string): Effect.Effect<Tag, ApiError> =>
      Effect.tryPromise({
        try: () => api.createTag(name, color),
        catch: catchToApiError("/_/api/tags"),
      });

    const update = (id: string, name: string, color?: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.updateTag(id, name, color),
        catch: catchToApiError(`/_/api/tags/${id}`),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.deleteTag(id),
        catch: catchToApiError(`/_/api/tags/${id}`),
      });

    const listSessions = (tagId: string): Effect.Effect<string[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchTagSessions(tagId),
        catch: catchToApiError(`/_/api/tags/${tagId}/sessions`),
      });

    const assignTag = (tagId: string, sessionId: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.assignTagToSession(tagId, sessionId),
        catch: catchToApiError(`/_/api/tags/${tagId}/sessions/${sessionId}`),
      });

    const unassignTag = (tagId: string, sessionId: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.unassignTagFromSession(tagId, sessionId),
        catch: catchToApiError(`/_/api/tags/${tagId}/sessions/${sessionId}`),
      });

    const listSessionTags = (sessionId: string): Effect.Effect<Tag[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSessionTags(sessionId),
        catch: catchToApiError(`/_/api/sessions/${sessionId}/tags`),
      });

    return {
      list,
      create,
      update,
      remove,
      listSessions,
      assignTag,
      unassignTag,
      listSessionTags,
    } as const;
  }),
}) {}
