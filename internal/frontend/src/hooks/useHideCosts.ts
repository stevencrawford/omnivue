import { useEffect, useState } from "react";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../utils/storageKeys";

const HIDE_COSTS_EVENT = "omnivue:hide-costs-changed";

function readHideCosts(): boolean {
  return getStorageItem(STORAGE_KEYS.HIDE_COSTS) === "true";
}

export function setHideCosts(hidden: boolean): void {
  setStorageItem(STORAGE_KEYS.HIDE_COSTS, hidden ? "true" : "false");
  window.dispatchEvent(new Event(HIDE_COSTS_EVENT));
}

/** Reactive view of the "hide costs" preference, kept in sync across tabs. */
export function useHideCosts(): boolean {
  const [hide, setHide] = useState(readHideCosts);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.HIDE_COSTS) setHide(e.newValue === "true");
    };
    const onLocal = () => setHide(readHideCosts());
    window.addEventListener("storage", onStorage);
    window.addEventListener(HIDE_COSTS_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HIDE_COSTS_EVENT, onLocal);
    };
  }, []);

  return hide;
}
