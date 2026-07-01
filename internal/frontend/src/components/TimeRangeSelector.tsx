import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import type { TimeRangePreset } from "../hooks/useTimeRange";

interface TimeRangeSelectorProps {
  preset: TimeRangePreset;
  label: string;
  customStart?: string;
  customEnd?: string;
  onPresetChange: (preset: TimeRangePreset) => void;
  onCustomRangeChange: (start: string, end: string) => void;
}

const PRESETS: { key: TimeRangePreset; label: string }[] = [
  { key: "1d", label: "1d" },
  { key: "3d", label: "3d" },
  { key: "7d", label: "7d" },
  { key: "1mo", label: "1mo" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return isoDate(new Date());
}

export function TimeRangeSelector({
  preset,
  label,
  customStart,
  customEnd,
  onPresetChange,
  onCustomRangeChange,
}: TimeRangeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(customStart || todayISO());
  const [draftEnd, setDraftEnd] = useState(customEnd || todayISO());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setCustomOpen(false);
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSelect = useCallback(
    (key: TimeRangePreset) => {
      onPresetChange(key);
      setOpen(false);
    },
    [onPresetChange],
  );

  const handleCustomClick = useCallback(() => {
    setCustomOpen((v) => !v);
  }, []);

  const handleApplyCustom = useCallback(() => {
    onCustomRangeChange(draftStart, draftEnd);
    setOpen(false);
  }, [draftStart, draftEnd, onCustomRangeChange]);

  const displayLabel = preset === "custom" ? "Custom" : label;

  return (
    <div className="ov-timerange" ref={containerRef}>
      <button type="button" className="ov-timerange-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="ov-timerange-trigger-label">{displayLabel}</span>
        <ChevronDown
          size={12}
          className={`ov-timerange-trigger-chevron${open ? " ov-timerange-trigger-chevron--open" : ""}`}
        />
      </button>

      {open && (
        <div className="ov-timerange-menu">
          {PRESETS.map(({ key, label: pLabel }) => (
            <button
              key={key}
              type="button"
              className={`ov-timerange-menu-item${key === preset ? " ov-timerange-menu-item--active" : ""}`}
              onClick={() => handleSelect(key)}
            >
              {pLabel}
              {key === preset && <span className="ov-timerange-menu-check" />}
            </button>
          ))}
          <div className="ov-timerange-menu-divider" />
          <div className="ov-timerange-menu-item ov-timerange-menu-item--custom">
            <button
              type="button"
              className="ov-timerange-menu-custom-btn"
              onClick={handleCustomClick}
            >
              <Calendar size={12} />
              <span>Custom range</span>
              <ChevronDown
                size={10}
                className={`ov-timerange-chevron${customOpen ? " ov-timerange-chevron--open" : ""}`}
              />
            </button>

            {customOpen && (
              <div className="ov-timerange-custom-panel">
                <div className="ov-timerange-custom-row">
                  <label className="ov-timerange-custom-label">
                    Start
                    <input
                      type="date"
                      className="ov-timerange-date-input"
                      value={draftStart}
                      max={draftEnd}
                      onChange={(e) => setDraftStart(e.target.value)}
                    />
                  </label>
                  <span className="ov-timerange-custom-sep">–</span>
                  <label className="ov-timerange-custom-label">
                    End
                    <input
                      type="date"
                      className="ov-timerange-date-input"
                      value={draftEnd}
                      min={draftStart}
                      max={todayISO()}
                      onChange={(e) => setDraftEnd(e.target.value)}
                    />
                  </label>
                </div>
                <div className="ov-timerange-custom-actions">
                  <button
                    type="button"
                    className="ov-timerange-custom-cancel"
                    onClick={() => setCustomOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ov-timerange-custom-apply"
                    onClick={handleApplyCustom}
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
