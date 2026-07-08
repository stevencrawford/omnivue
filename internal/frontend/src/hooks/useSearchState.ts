import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import type { SearchResult } from "./useApi";
import type { Tab } from "../components/SessionViewer";
import { runFork } from "../lib/effect";
import { SearchService } from "../services";

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

  const cancelSearch = useRef<(() => void) | null>(null);

  function runSearch(query: string, limit: number, scope: string | undefined): void {
    cancelSearch.current?.();

    const cancel = runFork(
      SearchService.pipe(
        Effect.flatMap((svc) => svc.search(query, limit, scope)),
        Effect.map((results) => {
          setDrawerQuery(query);
          setDrawerResults(results || []);
          setDrawerOpen(true);
        }),
        Effect.catchAll(() =>
          Effect.sync(() => {
            setDrawerResults([]);
          }),
        ),
      ),
    );

    cancelSearch.current = cancel;
  }

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
