import { useState } from "react";
import { setHideCosts, useHideCosts } from "../../hooks/useHideCosts";
import { getStorageItem, setStorageItem, STORAGE_KEYS } from "../../utils/storageKeys";
import { Toggle } from "../Toggle";

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
      <Toggle
        checked={hideCosts}
        onChange={(checked) => setHideCosts(checked)}
        label="Hide costs"
        hint="Remove token and cost figures from session views."
      />
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
      <Toggle
        checked={disabled}
        onChange={(checked) => {
          setDisabled(checked);
          setStorageItem(STORAGE_KEYS.DISABLE_CUSTOM_RENDERERS, checked ? "true" : "false");
        }}
        label="Disable custom tool call renderers"
        hint="Display all tool calls using the default input/output view for debugging."
      />
    </div>
  );
}
