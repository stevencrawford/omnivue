import { GraduationCap, Loader2 } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { ToolActionsBar } from "../ToolActionsBar";
import { MarkdownContent } from "../../ui/MarkdownContent";

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

  const isFailed = tool.status === "failed";

  const skillContentBlocks = extractSkillContentBlocks(tool.output || "");

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
        {!isFailed && name && tool.status !== "completed" && (
          <Loader2 size={10} className="animate-spin text-sky-400/60 shrink-0" />
        )}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-sky-500/20 bg-sky-500/[0.04]">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-500/[0.04] border-b border-sky-500/15">
        <GraduationCap size={12} className="text-sky-400 shrink-0" />
        <span className="text-[11px] font-semibold text-sky-400">Skill</span>
        <span className="text-sky-400/30 text-[11px]">·</span>
        <span
          className={`text-[11px] font-medium truncate ${isFailed ? "text-red-400" : "text-sky-300"}`}
          title={name || "Skill"}
        >
          {name || "Loading skill"}
        </span>
        {!isFailed && name && tool.status !== "completed" && (
          <Loader2 size={12} className="animate-spin text-sky-400/70 shrink-0" />
        )}
        {description && (
          <span className="text-[11px] leading-snug text-ov-text-secondary/70 truncate ml-1">
            — {description}
          </span>
        )}
      </div>
      {skillContentBlocks.length > 0 && (
        <div className="bg-sky-500/[0.02]">
          <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-sky-500/10">
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
          <div className="px-3 pb-3 pt-2 space-y-3">
            {skillContentBlocks.map((block, idx) => (
              <MarkdownContent
                key={idx}
                content={block}
                className="markdown-body--wide text-xs"
                onOpenModal={onOpenModal ? () => onOpenModal(block, name || "Skill") : undefined}
              />
            ))}
          </div>
        </div>
      )}
      {!description && skillContentBlocks.length === 0 && tool.status !== "completed" && (
        <div className="px-3 py-3 flex items-center gap-2 text-[11px] text-sky-400/60">
          <Loader2 size={12} className="animate-spin" />
          <span className="font-mono">Resolving skill…</span>
        </div>
      )}
    </div>
  );
}

function extractSkillContentBlocks(output: string): string[] {
  const blocks: string[] = [];
  const patterns = [
    /<skill_content[^>]*>([\s\S]*?)<\/skill_content>/gi,
    /<skill[-_]?context[^>]*>([\s\S]*?)<\/skill[-_]?context>/gi,
    /<skill[^>]*>([\s\S]*?)<\/skill>/gi,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    // Reset lastIndex for global regex reuse
    re.lastIndex = 0;
    while ((match = re.exec(output)) !== null) {
      const inner = match[1].trim();
      if (inner) blocks.push(inner);
    }
    if (blocks.length > 0) return blocks;
  }
  // Generic fallback for agents that don't wrap skill content in XML:
  // if no tags found but output looks like markdown, render it as markdown
  // as well (below the raw output). Avoid duplicate for plain text.
  const trimmed = output.trim();
  if (trimmed && trimmed.length > 20) {
    const hasMarkdown =
      /(^#{1,6}\s)|(^[-*]\s)|(^\d+\.\s)|```|>\s|\[.+?\]\(.+?\)/m.test(trimmed) ||
      trimmed.includes("\n# ") ||
      trimmed.includes("\n- ") ||
      trimmed.includes("```");
    if (hasMarkdown) blocks.push(trimmed);
  }
  return blocks;
}
