import { useEffect } from "react";
import type { Session } from "./types";
import type { Tab } from "../components/SessionViewer";

export interface AppKeyboardConfig {
  sessions: Session[];
  activeSessionId: string | null;
  // Search state
  searchOpen: boolean;
  drawerOpen: boolean;
  searchHighlightQuery: string | null;
  // State setters (local UI + search scope)
  setSearchOpen: (open: boolean) => void;
  setSearchSessionScope: (id: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
  setDrawerResults: (results: never[]) => void;
  setSidebarOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  // Navigation intent verbs
  setActiveTab: (tab: Tab) => void;
  clearSearchHighlight: () => void;
  setShowOverview: (v: boolean) => void;
  navigateSession: (delta: 1 | -1, sessions: Session[]) => void;
  onOpenShortcuts?: () => void;
}

export function useAppKeyboard(config: AppKeyboardConfig) {
  const {
    sessions,
    activeSessionId,
    searchOpen,
    drawerOpen,
    searchHighlightQuery,
    setSearchOpen,
    setSearchSessionScope,
    setDrawerOpen,
    setDrawerResults,
    setSidebarOpen,
    setActiveTab,
    clearSearchHighlight,
    setShowOverview,
    navigateSession,
    onOpenShortcuts,
  } = config;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
          clearSearchHighlight();
          return;
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        if (isInput) return;
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
          clearSearchHighlight();
          setShowOverview(false);
          navigateSession(1, sessions);
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          clearSearchHighlight();
          setShowOverview(false);
          navigateSession(-1, sessions);
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
    setSidebarOpen,
    setActiveTab,
    clearSearchHighlight,
    setShowOverview,
    navigateSession,
    onOpenShortcuts,
  ]);
}
