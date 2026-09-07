import { useEffect, useState } from "react";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../utils/storageKeys";

const DISABLE_RENDERERS_EVENT = "omnivue:disable-renderers-changed";

function readDisableCustomRenderers(): boolean {
  return getStorageItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS) === "true";
}

export function setDisableCustomRenderers(disabled: boolean): void {
  setStorageItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS, disabled ? "true" : "false");
  window.dispatchEvent(new Event(DISABLE_RENDERERS_EVENT));
}

/** Reactive view of the "disable custom renderers" preference, kept in sync across tabs. */
export function useDisableCustomRenderers(): boolean {
  const [disabled, setDisabled] = useState(readDisableCustomRenderers);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS) setDisabled(e.newValue === "true");
    };
    const onLocal = () => setDisabled(readDisableCustomRenderers());
    window.addEventListener("storage", onStorage);
    window.addEventListener(DISABLE_RENDERERS_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(DISABLE_RENDERERS_EVENT, onLocal);
    };
  }, []);

  return disabled;
}
