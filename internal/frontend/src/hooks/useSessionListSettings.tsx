import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchConfig, setConfig } from "./apiClient";
import { STALE_DAYS } from "../utils/sessionFilters";

const CONFIG_HIDE_STALE = "sessions.hideStale";
const CONFIG_STALE_DAYS = "sessions.staleDays";

export const STALE_DAYS_MIN = 1;
export const STALE_DAYS_MAX = 365;

export interface SessionListSettings {
  hideStale: boolean;
  staleDays: number;
  setHideStale: (v: boolean) => void;
  setStaleDays: (v: number) => void;
}

const SessionListSettingsContext = createContext<SessionListSettings | null>(null);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseDays(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(STALE_DAYS_MAX, Math.max(STALE_DAYS_MIN, Math.round(n)));
}

export function SessionListSettingsProvider({ children }: { children: ReactNode }) {
  const [hideStale, setHideStaleState] = useState(true);
  const [staleDays, setStaleDaysState] = useState(STALE_DAYS);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .catch(() => ({}) as Record<string, string>)
      .then((cfg) => {
        if (cancelled) return;
        setHideStaleState(parseBool(cfg[CONFIG_HIDE_STALE], true));
        setStaleDaysState(parseDays(cfg[CONFIG_STALE_DAYS], STALE_DAYS));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setHideStale = useCallback((v: boolean) => {
    setHideStaleState(v);
    setConfig(CONFIG_HIDE_STALE, v ? "true" : "false").catch(() => {
      /* ignore */
    });
  }, []);

  const setStaleDays = useCallback((v: number) => {
    const clamped = Math.min(STALE_DAYS_MAX, Math.max(STALE_DAYS_MIN, Math.round(v)));
    setStaleDaysState(clamped);
    setConfig(CONFIG_STALE_DAYS, String(clamped)).catch(() => {
      /* ignore */
    });
  }, []);

  return (
    <SessionListSettingsContext.Provider
      value={{ hideStale, staleDays, setHideStale, setStaleDays }}
    >
      {children}
    </SessionListSettingsContext.Provider>
  );
}

export function useSessionListSettings(): SessionListSettings {
  const ctx = useContext(SessionListSettingsContext);
  if (!ctx)
    throw new Error("useSessionListSettings must be used within a SessionListSettingsProvider");
  return ctx;
}
