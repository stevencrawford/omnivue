import { Copy, Check } from "lucide-react";
import { useCopy } from "../hooks/useCopy";

export function CopyButton({
  text,
  className = "",
  iconSize = 12,
}: {
  text: string;
  className?: string;
  iconSize?: number;
}) {
  const { copied, copy } = useCopy(1500);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(text);
      }}
      className={`opacity-0 group-hover:opacity-100 transition-opacity size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated shrink-0 ${className}`}
      title="Copy"
    >
      {copied ? <Check className="text-emerald-400" size={iconSize} /> : <Copy size={iconSize} />}
    </button>
  );
}
