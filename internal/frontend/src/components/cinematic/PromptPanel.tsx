import type { Message } from "../../hooks/types";
import { UserPromptBubble } from "../UserPromptBubble";

interface PromptPanelProps {
  firstMessage?: Message | null;
  onOpenModal?: (content: string, title?: string) => void;
}

/** The session's initial prompt, shown as the first tab of the workspace. */
export function PromptPanel({ firstMessage, onOpenModal }: PromptPanelProps) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-4">
      {firstMessage ? (
        <UserPromptBubble message={firstMessage} onOpenModal={onOpenModal} />
      ) : (
        <p className="text-xs text-ov-text-secondary/70">This session has no initial prompt.</p>
      )}
    </div>
  );
}
