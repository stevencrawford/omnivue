import { ChevronLeft } from "lucide-react";

interface SubAgentBackButtonProps {
  /** Display name of the parent session, surfaced in the tooltip/label. */
  parentLabel: string;
  onBack: () => void;
}

/**
 * Header control shown while viewing a sub-agent. It replaces the family
 * selector so descending into a sub-agent is a one-way move until the user
 * explicitly backs out to the parent session (click, or Escape).
 */
export function SubAgentBackButton({ parentLabel, onBack }: SubAgentBackButtonProps) {
  return (
    <button
      type="button"
      onClick={onBack}
      title={`Back to ${parentLabel}`}
      aria-label={`Back to ${parentLabel}`}
      className="flex items-center gap-0.5 shrink-0 pl-0.5 pr-1.5 py-0.5 rounded-md border border-ov-border bg-ov-bg-secondary text-xs text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
    >
      <ChevronLeft size={13} className="shrink-0 text-ov-text-secondary" />
      <span className="truncate max-w-[10rem]">Back</span>
    </button>
  );
}
