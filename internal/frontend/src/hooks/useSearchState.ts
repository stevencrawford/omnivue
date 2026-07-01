import { useCallback, useRef, useState } from "react";
import type { SearchResult } from "./useApi";
import { fetchSearch } from "./useApi";
import type { Tab } from "../components/SessionViewer";

export function useSearchState(
  addSearch: (q: string) => void,
  searchSessionScope: string | null,
  setActiveSessionId: (id: string | null) => void,
  setActiveTab: (tab: Tab) => void,
  setSearchHighlightQuery: (q: string | null) => void,
  setFocusStepIndex: (idx: number | undefined) => void,
  setFocusMessageIndex: (idx: number | undefined) => void,
  setShowOverview: (v: boolean) => void,
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState("");
  const [drawerResults, setDrawerResults] = useState<SearchResult[]>([]);

  // AbortController ref to cancel in-flight search requests and prevent
  // race conditions when the user rapidly changes scope or triggers searches.
  const abortRef = useRef<AbortController | null>(null);

  const handleSearchSelect = useCallback(
    (
      sessionId: string,
      chunkType: string,
      query: string,
      fileId?: string,
      messageIndex?: number,
    ) => {
      if (query.trim()) addSearch(query);
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
    ],
  );

  const handleSearchOpenDrawer = useCallback(
    async (q: string) => {
      if (q.trim()) addSearch(q);
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await fetchSearch(
          q.trim(),
          100,
          searchSessionScope ?? undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setDrawerQuery(q);
        setDrawerResults(data || []);
        setDrawerOpen(true);
      } catch {
        if (!controller.signal.aborted) {
          setDrawerResults([]);
        }
      }
    },
    [searchSessionScope, addSearch],
  );

  const handleDrawerClose = useCallback(() => {
    setDrawerOpen(false);
    setDrawerResults([]);
  }, []);

  const handleDrawerClearScope = useCallback(() => {
    if (drawerQuery.trim()) {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetchSearch(drawerQuery.trim(), 100, undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setDrawerResults(data || []);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setDrawerResults([]);
          }
        });
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
