interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, label, hint, disabled, className }: ToggleProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-ov-text">{label}</p>
        {hint && <p className="text-[11px] text-ov-text-secondary mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-ov-bg-active"
        } ${disabled ? "cursor-default opacity-50" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-ov-bg-secondary shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
