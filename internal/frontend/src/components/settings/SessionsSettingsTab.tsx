import {
  useSessionListSettings,
  STALE_DAYS_MIN,
  STALE_DAYS_MAX,
} from "../../hooks/useSessionListSettings";

export function SessionsSettingsTab() {
  const { hideStale, staleDays, setHideStale, setStaleDays } = useSessionListSettings();

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Sessions
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Control how the session list is displayed.
      </p>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={hideStale}
          onChange={(e) => setHideStale(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-xs text-ov-text">Hide completed sessions</span>
      </label>
      <p className="text-[11px] text-ov-text-secondary mt-1 ml-5">
        Keep the list focused on active and recent work. Older completed sessions are tucked away
        and can be revealed from the sidebar.
      </p>

      <div className={`mt-4 ${hideStale ? "" : "opacity-50 pointer-events-none"}`}>
        <label
          htmlFor="stale-days"
          className="block text-[11px] font-medium text-ov-text-secondary mb-1"
        >
          Hide sessions idle for more than N days
        </label>
        <input
          id="stale-days"
          type="number"
          min={STALE_DAYS_MIN}
          max={STALE_DAYS_MAX}
          value={staleDays}
          disabled={!hideStale}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) setStaleDays(v);
          }}
          className="w-24 text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 text-ov-text outline-none focus:border-accent disabled:opacity-50"
        />
        <p className="text-[11px] text-ov-text-secondary mt-1.5">
          Hidden sessions remain searchable with ⌘K.
        </p>
      </div>
    </div>
  );
}
