import { setHideCosts, useHideCosts } from "../../hooks/useHideCosts";
import {
  setDisableCustomRenderers,
  useDisableCustomRenderers,
} from "../../hooks/useDisableCustomRenderers";
import { Toggle } from "../ui/Toggle";

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
  const disabled = useDisableCustomRenderers();

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
          setDisableCustomRenderers(checked);
        }}
        label="Disable custom tool call renderers"
        hint="Display all tool calls using the default input/output view for debugging."
      />
    </div>
  );
}
