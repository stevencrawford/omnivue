import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bookmark } from "./types";
import { fetchBookmarks, createBookmark, deleteBookmark } from "./apiClient";

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
      const data = await fetchBookmarks();
      setBookmarks(data ?? []);
    } catch (err) {
      console.error("[bookmarks] failed to load:", err instanceof Error ? err.message : err);
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
      try {
        await createBookmark({ sessionId, messageIndex, toolCallId, label });
      } catch (err) {
        console.error("Failed to create bookmark:", err instanceof Error ? err.message : err);
      }
      await loadBookmarks();
    },
    [loadBookmarks],
  );

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      try {
        await deleteBookmark(id);
      } catch (err) {
        console.error("Failed to delete bookmark:", err instanceof Error ? err.message : err);
      }
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
