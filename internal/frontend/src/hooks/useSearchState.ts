import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "./types";
import type { Tab } from "../components/SessionViewer";
import { fetchSearch } from "./apiClient";
import { isAbortError } from "../utils/errors";

export function useSearchState(
  addSearch: (q: string) => void,
  searchSessionScope: string | null,
  setActiveSessionId: (id: string | null) => void,
  setActiveTab: (tab: Tab) => void,
  setSearchHighlightQuery: (q: string | null) => void,
  setFocusStepIndex: (idx: number | undefined) => void,
  setFocusMessageIndex: (idx: number | undefined) => void,
  setShowOverview: (v: boolean) => void,
  onOpenTag: (name: string) => void,
) {
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
      setShowOverview(false);
      setActiveSessionId(sessionId);
      const tabMap: Record<string, Tab> = {
        name: "session",
        message: "session",
        messages: "session",
        plan: "plan",
      };
      if (chunkType === "scratch" && fileId) {
        setActiveTab(`scratch:${fileId}`);
      } else {
        setActiveTab(tabMap[chunkType] || "session");
      }
      setSearchHighlightQuery(query || null);
      setFocusStepIndex(undefined);
      setFocusMessageIndex(messageIndex);
      setDrawerOpen(false);
    },
    [
      addSearch,
      setActiveSessionId,
      setActiveTab,
      setSearchHighlightQuery,
      setFocusStepIndex,
      setFocusMessageIndex,
      setShowOverview,
      onOpenTag,
    ],
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
