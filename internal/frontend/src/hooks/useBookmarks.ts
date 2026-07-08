import { useCallback, useEffect, useMemo, useState } from "react";
import { Effect } from "effect";
import type { Bookmark } from "./types";
import { BookmarkService, ApiError } from "../services";
import { runPromise } from "../lib/effect";

export interface BookmarksState {
  bookmarks: Bookmark[];
  /** Map of `${sessionId}:${messageIndex}:${toolCallId}` → bookmark id */
  bookmarkIdByRef: Record<string, string>;
  loadBookmarks: () => Promise<void>;
  handleBookmark: (
    sessionId: string,
    messageIndex: number,
    toolCallId: string | undefined,
    label: string,
  ) => Promise<void>;
  handleBookmarkDelete: (id: string) => Promise<void>;
}

function listBookmarksEffect() {
  return BookmarkService.pipe(
    Effect.flatMap((svc) => svc.list()),
    Effect.catchAll((err: ApiError) => {
      console.error("[bookmarks] failed to load:", err.message);
      return Effect.succeed([] as Bookmark[]);
    }),
  );
}

function createBookmarkEffect(
  sessionId: string,
  messageIndex: number,
  toolCallId: string | undefined,
  label: string,
) {
  return BookmarkService.pipe(
    Effect.flatMap((svc) => svc.create({ sessionId, messageIndex, toolCallId, label })),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to create bookmark:", err.message)),
    ),
  );
}

function deleteBookmarkEffect(id: string) {
  return BookmarkService.pipe(
    Effect.flatMap((svc) => svc.remove(id)),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to delete bookmark:", err.message)),
    ),
  );
}

export function useBookmarks(): BookmarksState {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const bookmarkIdByRef = useMemo(() => {
    const map: Record<string, string> = {};
    for (const bm of bookmarks) {
      const key = `${bm.sessionId}:${bm.messageIndex}:${bm.toolCallId || ""}`;
      map[key] = bm.id;
    }
    return map;
  }, [bookmarks]);

  const loadBookmarks = useCallback(async () => {
    try {
      const data = await runPromise(listBookmarksEffect());
      setBookmarks(data ?? []);
    } catch {
      setBookmarks([]);
    }
  }, []);

  const handleBookmark = useCallback(
    async (
      sessionId: string,
      messageIndex: number,
      toolCallId: string | undefined,
      label: string,
    ) => {
      await runPromise(createBookmarkEffect(sessionId, messageIndex, toolCallId, label));
      await loadBookmarks();
    },
    [loadBookmarks],
  );

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      await runPromise(deleteBookmarkEffect(id));
      await loadBookmarks();
    },
    [loadBookmarks],
  );

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  return {
    bookmarks,
    bookmarkIdByRef,
    loadBookmarks,
    handleBookmark,
    handleBookmarkDelete,
  };
}
