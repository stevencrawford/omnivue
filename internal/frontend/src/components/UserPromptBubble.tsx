import { useState } from "react";
import type { Message } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";

export function UserPromptBubble({
  message,
  onOpenModal,
}: {
  message: Message;
  onOpenModal?: (content: string, title?: string) => void;
}) {
  const lines = message.content.split("\n");
  const isLong = lines.length > 20;
  const [expanded, setExpanded] = useState(false);
  const display = !expanded && isLong ? lines.slice(0, 20).join("\n") + "\n\n..." : message.content;

  return (
    <div>
      <MarkdownContent
        content={display}
        className="markdown-body--wide"
        onOpenModal={() => onOpenModal?.(message.content, "Initial prompt")}
        modalTitle="Initial prompt"
      />
      {isLong && (
        <button
          type="button"
          className="mt-1 text-[11px] text-accent hover:text-accent-secondary cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
