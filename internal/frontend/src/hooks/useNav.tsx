import { createContext, useContext } from "react";

interface SessionNavValue {
  navigateToSession: (id: string) => void;
  scrollPositions: Map<string, number>;
  saveScrollPosition: (id: string, pos: number) => void;
}

export const SessionNavContext = createContext<SessionNavValue>({
  navigateToSession: () => {},
  scrollPositions: new Map(),
  saveScrollPosition: () => {},
});

export function useSessionNav() {
  return useContext(SessionNavContext);
}

// Context for search highlighting — lets MarkdownContent highlight inline matches
// without prop-drilling through all message rendering components.
export const SearchHighlightContext = createContext<string>("");

export function useSearchHighlight() {
  return useContext(SearchHighlightContext);
}
