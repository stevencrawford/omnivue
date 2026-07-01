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
      setBookmarks(data || []);
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
      try {
        await createBookmark({ sessionId, messageIndex, toolCallId, label });
        await loadBookmarks();
      } catch {
        /* ignore — will be replaced with toast in Phase 5 */
      }
    },
    [loadBookmarks],
  );

  const handleBookmarkDelete = useCallback(
    async (id: string) => {
      try {
        await deleteBookmark(id);
        await loadBookmarks();
      } catch {
        /* ignore */
      }
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
