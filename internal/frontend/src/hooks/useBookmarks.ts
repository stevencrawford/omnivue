import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bookmark, BookmarkKind } from "./types";
import { fetchBookmarks, createBookmark, deleteBookmark } from "./apiClient";
import { runCatching } from "../utils/errors";

/**
 * Sentinel messageId used for plan bookmarks. Plans are not anchored to a
 * message, so the ref key is `${sessionId}::`. Message bookmarks always use a
 * real messageId, so this never collides with them.
 */
export const PLAN_BOOKMARK_MESSAGE_ID = "__plan__";

export function bookmarkRefKey(
  sessionId: string,
  messageId: string | undefined,
  toolCallId: string | undefined,
): string {
  return `${sessionId}:${messageId || ""}:${toolCallId || ""}`;
}

export interface BookmarksState {
  bookmarks: Bookmark[];
  /** Map of `${sessionId}:${messageId}:${toolCallId}` → bookmark id */
  bookmarkIdByRef: Record<string, string>;
  loadBookmarks: () => Promise<void>;
  handleBookmark: (
    sessionId: string,
    messageId: string | undefined,
    toolCallId: string | undefined,
    label: string,
    kind?: BookmarkKind,
  ) => Promise<void>;
  handleBookmarkDelete: (id: string) => Promise<void>;
}

export function useBookmarks(): BookmarksState {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  const bookmarkIdByRef = useMemo(() => {
    const map: Record<string, string> = {};
    for (const bm of bookmarks) {
      const key = bookmarkRefKey(bm.sessionId, bm.messageId, bm.toolCallId);
      map[key] = bm.id;
    }
    return map;
  }, [bookmarks]);

  const loadBookmarks = useCallback(async () => {
    const data = await runCatching(
      () => fetchBookmarks(),
      (err) => {
        console.error("[bookmarks] failed to load:", err instanceof Error ? err.message : err);
      },
    );
    setBookmarks(data ?? []);
  }, []);

  const handleBookmark = useCallback(
    async (
      sessionId: string,
      messageId: string | undefined,
      toolCallId: string | undefined,
      label: string,
      kind: BookmarkKind = "message",
    ) => {
      await runCatching(
        () => createBookmark({ sessionId, messageId, toolCallId, label, kind }),
        (err) =>
          console.error("Failed to create bookmark:", err instanceof Error ? err.message : err),
      );
      await loadBookmarks();
    },
    [loadBookmarks],
  );

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      await runCatching(
        () => deleteBookmark(id),
        (err) =>
          console.error("Failed to delete bookmark:", err instanceof Error ? err.message : err),
      );
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
