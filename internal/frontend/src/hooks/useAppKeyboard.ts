import { useEffect } from "react";
import type { Session } from "./useApi";
import type { Tab } from "../components/SessionViewer";

export function useAppKeyboard(
  sessions: Session[],
  activeSessionId: string | null,
  searchOpen: boolean,
  drawerOpen: boolean,
  searchHighlightQuery: string | null,
  setSearchOpen: (open: boolean) => void,
  setSearchSessionScope: (id: string | null) => void,
  setDrawerOpen: (open: boolean) => void,
  setDrawerResults: (results: never[]) => void,
  setSearchHighlightQuery: (q: string | null) => void,
  setSidebarOpen: (open: boolean | ((v: boolean) => boolean)) => void,
  setActiveTab: (tab: Tab) => void,
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>,
  setFocusMessageIndex: (idx: number | undefined) => void,
  onOpenShortcuts?: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "k")) {
        e.preventDefault();
        if (drawerOpen) {
          setDrawerOpen(false);
          setDrawerResults([]);
        }
        setSearchOpen(!searchOpen);
        if (!searchOpen) setSearchSessionScope(activeSessionId);
        return;
      }
      if (e.key === "Escape") {
        if (drawerOpen) {
          setDrawerOpen(false);
          setDrawerResults([]);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (searchHighlightQuery) {
          setSearchHighlightQuery(null);
          setFocusMessageIndex(undefined);
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v: boolean) => !v);
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        if (!isInput) {
          e.preventDefault();
          onOpenShortcuts?.();
          return;
        }
      }

      if (searchOpen || drawerOpen) return;

      if ((e.metaKey || e.ctrlKey) && !isInput) {
        const tabMap: Record<string, Tab> = {
          "1": "session",
          "2": "diff",
        };
        const tab = tabMap[e.key];
        if (tab) {
          e.preventDefault();
          setActiveTab(tab);
          return;
        }
      }

      if (!isInput && !e.metaKey && !e.ctrlKey) {
        if (e.key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setSearchHighlightQuery(null);
          setActiveSessionId((prev: string | null) => {
            const idx = sessions.findIndex((s) => s.id === prev);
            if (idx < sessions.length - 1) return sessions[idx + 1].id;
            return prev;
          });
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSearchHighlightQuery(null);
          setActiveSessionId((prev: string | null) => {
            const idx = sessions.findIndex((s) => s.id === prev);
            if (idx > 0) return sessions[idx - 1].id;
            return prev;
          });
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    searchOpen,
    sessions,
    drawerOpen,
    activeSessionId,
    searchHighlightQuery,
    setSearchOpen,
    setSearchSessionScope,
    setDrawerOpen,
    setDrawerResults,
    setSearchHighlightQuery,
    setSidebarOpen,
    setActiveTab,
    setActiveSessionId,
    setFocusMessageIndex,
  ]);
}
