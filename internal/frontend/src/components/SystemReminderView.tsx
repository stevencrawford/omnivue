import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";

export function SystemReminderView({
  content,
  fileName,
  onOpenModal,
}: {
  content: string;
  fileName: string;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split("\n");
  const isLong = lines.length > 20;
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n\u2026" : content;

  return (
    <div className="border border-amber-500/30 rounded-lg bg-amber-500/[0.03] mx-4 mb-3 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20">
        <TriangleAlert size={16} className="text-amber-400 shrink-0" />
        <span className="font-semibold text-[11px] text-amber-400 uppercase">{fileName}</span>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          {!expanded && isLong && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--color-ov-bg-secondary)] to-transparent z-10 pointer-events-none" />
          )}
          <MarkdownContent
            content={display}
            className="markdown-body--wide"
            onOpenModal={onOpenModal ? () => onOpenModal(content, fileName) : undefined}
            modalTitle={fileName}
          />
        </div>
      </div>
      {isLong && (
        <div className="flex justify-center border-t border-amber-500/10">
          <button type="button" className="sess-tool-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}
