import { useCallback, useState } from "react";
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
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState("");
  const [drawerResults, setDrawerResults] = useState<SearchResult[]>([]);

  const handleSearchSelect = useCallback(
    (
      sessionId: string,
      chunkType: string,
      query: string,
      fileId?: string,
      messageIndex?: number,
    ) => {
      if (query.trim()) addSearch(query);
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
    ],
  );

  const handleSearchOpenDrawer = useCallback(
    async (q: string) => {
      if (q.trim()) addSearch(q);
      try {
        const data = await fetchSearch(q.trim(), 100, searchSessionScope ?? undefined);
        setDrawerQuery(q);
        setDrawerResults(data || []);
        setDrawerOpen(true);
      } catch {
        setDrawerResults([]);
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
      fetchSearch(drawerQuery.trim(), 100)
        .then((data) => {
          setDrawerResults(data || []);
        })
        .catch(() => {
          setDrawerResults([]);
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
