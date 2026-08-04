import { useState } from "react";
import { setHideCosts, useHideCosts } from "../../hooks/useHideCosts";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../../utils/storageKeys";

export function PrivacySettingsTab() {
  const hideCosts = useHideCosts();

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Privacy
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Control what data is displayed in the UI.
      </p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={hideCosts}
          onChange={(e) => setHideCosts(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-xs text-ov-text">Hide costs</span>
      </label>
    </div>
  );
}

export function DeveloperSettingsTab() {
  const [disabled, setDisabled] = useState(
    () => getStorageItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS) === "true",
  );

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Developer
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Tools for debugging and contributing to Omnivue.
      </p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={disabled}
          onChange={(e) => {
            setDisabled(e.target.checked);
            setStorageItem(
              STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS,
              e.target.checked ? "true" : "false",
            );
          }}
          className="accent-accent"
        />
        <span className="text-xs text-ov-text">Disable custom tool call renderers</span>
      </label>
      <p className="text-[11px] text-ov-text-secondary mt-1 ml-5">
        Display all tool calls using the default input/output view for debugging.
      </p>
    </div>
  );
}
