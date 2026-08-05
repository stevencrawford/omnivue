import { useEffect, useRef, useState } from "react";

export interface FilterChipProps {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  formatOption?: (opt: string) => string;
}

/**
 * A collapsed single-select filter control: shows the active value (or
 * "All {label}s"), and opens a dropdown listing the available options.
 * Clicking outside closes the dropdown.
 */
export function FilterChip({ label, value, options, onChange, formatOption }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const displayLabel = value ? (formatOption ? formatOption(value) : value) : `All ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[11px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          value
            ? "border-accent-border bg-accent-muted text-accent"
            : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
        }`}
      >
        {label}: {displayLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
          <button
            type="button"
            className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
              !value
                ? "text-ov-text bg-ov-bg-active"
                : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
            }`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            All {label}s
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors truncate capitalize ${
                value === opt
                  ? "text-ov-text bg-ov-bg-active"
                  : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {formatOption ? formatOption(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
