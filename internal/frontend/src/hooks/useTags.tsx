import { createContext, useContext } from "react";

interface TagsValue {
  version: number;
  bump: () => void;
  filterTag: string | null;
  openTag: (name: string) => void;
  clearFilter: () => void;
}

export const TagsContext = createContext<TagsValue>({
  version: 0,
  bump: () => {},
  filterTag: null,
  openTag: () => {},
  clearFilter: () => {},
});

export function useTagsContext() {
  return useContext(TagsContext);
}
