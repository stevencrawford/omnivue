import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "./types";
import type { Tab } from "../components/SessionViewer";
import type { SearchHitTarget } from "./useNavigation";
import { fetchSearch } from "./apiClient";
import { isAbortError } from "../utils/errors";

export interface UseSearchStateOptions {
  addSearch: (q: string) => void;
  searchSessionScope: string | null;
  onSelectHit: (target: SearchHitTarget) => void;
  onOpenTag: (name: string) => void;
}

export function useSearchState({
  addSearch,
  searchSessionScope,
  onSelectHit,
  onOpenTag,
}: UseSearchStateOptions) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState("");
  const [drawerResults, setDrawerResults] = useState<SearchResult[]>([]);

  const cancelSearch = useRef<AbortController | null>(null);

  function runSearch(query: string, limit: number, scope: string | undefined): void {
    cancelSearch.current?.abort();
    const controller = new AbortController();
    cancelSearch.current = controller;

    fetchSearch(query, limit, scope, controller.signal)
      .then((results) => {
        setDrawerQuery(query);
        setDrawerResults(results || []);
        setDrawerOpen(true);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setDrawerResults([]);
      });
  }

  useEffect(() => {
    return () => cancelSearch.current?.abort();
  }, []);

  const handleSearchSelect = useCallback(
    (
      sessionId: string,
      chunkType: string,
      query: string,
      fileId?: string,
      messageIndex?: number,
      tagName?: string,
    ) => {
      if (query.trim()) addSearch(query);
      if (chunkType === "tag") {
        onOpenTag((tagName || query).trim());
        setDrawerOpen(false);
        return;
      }
      const tabMap: Record<string, Tab> = {
        name: "session",
        message: "session",
        messages: "session",
        plan: "plan",
      };
      const tab: Tab =
        chunkType === "scratch" && fileId ? `scratch:${fileId}` : tabMap[chunkType] || "session";
      onSelectHit({ sessionId, tab, query: query || null, messageIndex });
      setDrawerOpen(false);
    },
    [addSearch, onSelectHit, onOpenTag],
  );

  const handleSearchOpenDrawer = useCallback(
    (q: string) => {
      if (q.trim()) addSearch(q);
      runSearch(q.trim(), 100, searchSessionScope ?? undefined);
    },
    [searchSessionScope, addSearch],
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setDrawerResults([]);
  }, []);

  const handleDrawerClearScope = useCallback(() => {
    if (drawerQuery.trim()) {
      runSearch(drawerQuery.trim(), 100, undefined);
    }
  }, [drawerQuery]);

  return {
    drawerOpen,
    setDrawerOpen,
    drawerQuery,
    drawerResults,
    setDrawerResults,
    handleSearchSelect,
    handleSearchOpenDrawer,
    handleDrawerClose,
    handleDrawerClearScope,
  };
}
