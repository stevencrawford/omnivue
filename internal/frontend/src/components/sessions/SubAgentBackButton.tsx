import { ArrowLeft } from "lucide-react";

interface SubAgentBackButtonProps {
  /** Display name of the parent session, surfaced in the tooltip/label. */
  parentLabel: string;
  onBack: () => void;
}

/**
 * Plain left-arrow shown immediately before a sub-agent's title. It returns to
 * the parent session so descending into a sub-agent is a one-way move until the
 * user backs out (arrow, or Escape).
 */
export function SubAgentBackButton({ parentLabel, onBack }: SubAgentBackButtonProps) {
  return (
    <button
      type="button"
      onClick={onBack}
      title={`Back to ${parentLabel}`}
      aria-label={`Back to ${parentLabel}`}
      className="shrink-0 flex items-center justify-center size-6 rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
    >
      <ArrowLeft size={16} />
    </button>
  );
}
