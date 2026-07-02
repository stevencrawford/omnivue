import { GraduationCap } from "lucide-react";
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
  onOpenModal: _onOpenModal,
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

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <GraduationCap size={12} className="text-sky-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">skill:</span>
        <span className="text-ov-text truncate min-w-0">
          {name || description || "Loading skill"}
        </span>
      </div>
    );
  }

  return (
    <div className="px-0">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-sky-400">
        <GraduationCap size={14} className="shrink-0" />
        <span className="font-medium text-sky-300 truncate flex-1">
          {name ? `Loading skill: ${name}` : "Loading skill"}
        </span>
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
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-ov-text-secondary whitespace-pre-wrap break-all border-t border-sky-500/20">
          {description}
        </pre>
      )}
      {tool.output && (
        <pre className="px-3 py-2 text-[11px] font-mono leading-relaxed text-ov-text-secondary whitespace-pre-wrap break-all border-t border-sky-500/20">
          {tool.output}
        </pre>
      )}
    </div>
  );
}
