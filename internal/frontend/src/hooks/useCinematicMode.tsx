import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchConfig, setConfig } from "./apiClient";

const CONFIG_CINEMATIC = "sessions.cinematicMode";
const STORAGE_KEY = "omnivue-cinematic";

export interface CinematicModeState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

const CinematicModeContext = createContext<CinematicModeState | null>(null);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function readLocal(): boolean | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  } catch {
    return null;
  }
}

function writeLocal(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function CinematicModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(() => readLocal() ?? false);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .catch(() => ({}) as Record<string, string>)
      .then((cfg) => {
        if (cancelled) return;
        const fromConfig = cfg[CONFIG_CINEMATIC];
        if (fromConfig === "true" || fromConfig === "false") {
          const v = parseBool(fromConfig, false);
          setEnabledState(v);
          writeLocal(v);
        } else {
          const local = readLocal();
          if (local !== null) setEnabledState(local);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    writeLocal(v);
    setConfig(CONFIG_CINEMATIC, v ? "true" : "false").catch(() => {
      /* ignore */
    });
  }, []);

  return (
    <CinematicModeContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </CinematicModeContext.Provider>
  );
}

export function useCinematicMode(): CinematicModeState {
  const ctx = useContext(CinematicModeContext);
  if (!ctx) throw new Error("useCinematicMode must be used within a CinematicModeProvider");
  return ctx;
}
