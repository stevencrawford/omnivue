import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { Bookmark } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class BookmarkService extends Effect.Service<BookmarkService>()("BookmarkService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Bookmark[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchBookmarks(),
        catch: catchToApiError("/_/api/bookmarks"),
      });

    const create = (data: {
      sessionId: string;
      messageIndex: number;
      toolCallId?: string;
      label: string;
    }): Effect.Effect<
      { action: "created" | "deleted"; bookmark?: Bookmark; id?: string },
      ApiError
    > =>
      Effect.tryPromise({
        try: () => api.createBookmark(data),
        catch: catchToApiError("/_/api/bookmarks"),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.deleteBookmark(id),
        catch: catchToApiError(`/_/api/bookmarks/${id}`),
      });

    return { list, create, remove } as const;
  }),
}) {}
