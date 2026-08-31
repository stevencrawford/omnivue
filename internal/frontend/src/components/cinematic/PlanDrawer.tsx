import { X, FileText } from "lucide-react";
import type { Plan } from "../../hooks/types";
import { MarkdownContent } from "../ui/MarkdownContent";

interface PlanDrawerProps {
  plan: Plan | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
}

export function PlanDrawer({ plan, loading, open, onClose }: PlanDrawerProps) {
  if (!open) return null;
  return (
    <div className="w-[380px] shrink-0 border-r border-ov-border bg-ov-bg flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-surface-elevated shrink-0">
        <FileText size={14} className="text-amber-400" />
        <span className="text-xs font-semibold text-ov-text">Plan</span>
        {plan?.source && <span className="text-[11px] text-ov-text-secondary">{plan.source}</span>}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer"
          title="Close plan"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-xs text-ov-text-secondary">Loading plan...</div>
        ) : plan?.markdown ? (
          <MarkdownContent content={plan.markdown} className="markdown-body--wide" />
        ) : (
          <div className="text-xs text-ov-text-secondary">No plan for this session</div>
        )}
      </div>
    </div>
  );
}
