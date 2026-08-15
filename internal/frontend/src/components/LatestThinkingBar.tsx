import { Loader2 } from "lucide-react";

// A live mirror of the newest thinking chunk, pinned just above the prompt
// drawer so the user can watch reasoning stream in without scrolling. It only
// renders while the session is active and disappears the moment thinking ends
// (the chunk itself stays recorded against its parent block in the
// conversation).
export function LatestThinkingBar({ chunk }: { chunk: string }) {
  return (
    <div className="shrink-0 border-t border-ov-border bg-ov-bg-secondary/60">
      <div className="px-4 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Loader2
            size={11}
            className="animate-spin text-accent"
            aria-label="thinking in progress"
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ov-text-secondary">
            Latest thinking
          </span>
        </div>
        <div className="text-xs text-ov-text-secondary whitespace-pre-wrap leading-relaxed line-clamp-6 overflow-hidden">
          {chunk}
        </div>
      </div>
    </div>
  );
}
