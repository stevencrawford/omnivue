import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";

export function SystemReminderView({ content, fileName }: { content: string; fileName: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-500/20 rounded-lg overflow-hidden bg-gray-500/[0.03] mb-3 mx-4">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-gray-500/20" />
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap hover:text-gray-300 transition-colors cursor-pointer"
          >
            <Info size={12} className="text-gray-400 shrink-0" />
            <span>{fileName}</span>
            {expanded ? (
              <ChevronUp size={10} className="text-gray-400" />
            ) : (
              <ChevronDown size={10} className="text-gray-400" />
            )}
          </button>
          <div className="flex-1 h-px bg-gray-500/20" />
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t border-gray-500/20">
            <MarkdownContent content={content} className="markdown-body--wide" />
          </div>
        )}
      </div>
    </div>
  );
}
