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
