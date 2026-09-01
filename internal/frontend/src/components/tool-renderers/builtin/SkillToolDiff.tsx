import { GraduationCap, Loader2, Check, Sparkles } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { ToolActionsBar } from "../ToolActionsBar";

interface SkillInput {
  name?: string;
  description?: string;
  skill?: string;
}

export function SkillToolDiff({
  tool,
  variant,
  onOpenModal,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
}: ToolRendererProps) {
  let input: SkillInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const name = input.name || input.skill || "";
  const description = input.description || "";
  const modalContent = [description, tool.output].filter(Boolean).join("\n\n");

  const isCompleted = tool.status === "completed";
  const isFailed = tool.status === "failed";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <div className="size-5 rounded-md bg-sky-500/15 flex items-center justify-center shrink-0">
          <GraduationCap size={11} className="text-sky-400" />
        </div>
        <span className="text-ov-text-secondary/70 shrink-0">skill</span>
        <span className="text-sky-400/60 shrink-0">·</span>
        <span
          className="text-ov-text truncate min-w-0 cursor-pointer hover:text-sky-400"
          title={name || description || "Loading skill"}
          onClick={(e) => {
            if (modalContent && onOpenModal) {
              e.stopPropagation();
              onOpenModal(modalContent, name || "Skill");
            }
          }}
        >
          {name || description || "Loading skill"}
        </span>
        {!isCompleted && !isFailed && name && (
          <Loader2 size={10} className="animate-spin text-sky-400/60 shrink-0" />
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-sky-500/20 bg-sky-500/[0.04]">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-sky-500/[0.06] border-b border-sky-500/15">
        <div className="size-8 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center shrink-0">
          <GraduationCap size={16} className="text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-sky-400/80">
              Skill
            </span>
            <span className="text-sky-400/30">·</span>
            <span className="text-[10px] font-mono text-sky-300/70 truncate">
              {tool.status || "loading"}
            </span>
          </div>
          <div className="text-xs font-medium text-sky-300 truncate flex items-center gap-1.5">
            {isFailed ? (
              <span className="text-red-400">{name || "Skill"}</span>
            ) : (
              <span>{name || "Loading skill"}</span>
            )}
            {!isCompleted && !isFailed && (
              <Loader2 size={12} className="animate-spin text-sky-400/70" />
            )}
            {isCompleted && <Check size={12} className="text-emerald-400" />}
          </div>
          {description && (
            <div className="text-[11px] leading-snug text-ov-text-secondary/80 truncate">
              {description}
            </div>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <Sparkles size={12} className="text-sky-400/40" />
        </div>
        <ToolActionsBar
          tool={tool}
          onPin={onPin}
          onBookmark={onBookmark}
          isBookmarked={isBookmarked}
          childSessionId={childSessionId}
          navigateToSession={navigateToSession}
          showPin
        />
      </div>
      {description && (
        <div className="px-3 py-2.5 border-t border-sky-500/10 bg-sky-500/[0.02]">
          <div className="text-[11px] font-medium text-ov-text-secondary mb-1">Description</div>
          <div className="text-xs leading-relaxed text-ov-text/90 whitespace-pre-wrap break-words">
            {description}
          </div>
        </div>
      )}
      {tool.output && (
        <div className="border-t border-sky-500/10">
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-sky-400/60">
              Output
            </span>
            <span className="h-px flex-1 bg-sky-500/10" />
          </div>
          <pre className="px-3 pb-3 pt-1 text-[11px] font-mono leading-relaxed text-ov-text-secondary whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {tool.output}
          </pre>
        </div>
      )}
      {!description && !tool.output && !isCompleted && (
        <div className="px-3 py-3 flex items-center gap-2 text-[11px] text-sky-400/60">
          <Loader2 size={12} className="animate-spin" />
          <span className="font-mono">Resolving skill…</span>
        </div>
      )}
    </div>
  );
}
