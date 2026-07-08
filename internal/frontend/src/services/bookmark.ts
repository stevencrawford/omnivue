import { Effect } from "effect";
import * as api from "../hooks/apiClient";
import type { Bookmark } from "../hooks/types";
import { ApiError } from "./common";

export class BookmarkService extends Effect.Service<BookmarkService>()("BookmarkService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Bookmark[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchBookmarks(),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/bookmarks"),
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
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/bookmarks"),
      });

    const remove = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.deleteBookmark(id),
        catch: (e) =>
          new ApiError(String(e), e instanceof Response ? e.status : 0, `/_/api/bookmarks/${id}`),
      });

    return { list, create, remove } as const;
  }),
}) {}
