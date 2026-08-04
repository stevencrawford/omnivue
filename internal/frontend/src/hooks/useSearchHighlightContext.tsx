import { createContext, useContext } from "react";

// Context for search highlighting — lets MarkdownContent highlight inline matches
// without prop-drilling through all message rendering components.
export const SearchHighlightContext = createContext<string>("");

export function useSearchHighlight() {
  return useContext(SearchHighlightContext);
}
