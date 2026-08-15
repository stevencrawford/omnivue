import { Pin, ArrowRight as ArrowRightIcon, Bookmark } from "lucide-react";
import type { ToolCall } from "../../hooks/types";
import ModeAwareCopyButton from "./ModeAwareCopyButton";
import { MarkdownScreenshotButton } from "../MarkdownScreenshotButton";

export function ToolActionsBar({
  tool,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
  showPin,
  showCopy = true,
  copyText,
  pinText,
  screenshotText,
  inputText,
  copyKind,
}: {
  tool: ToolCall;
  onPin?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  childSessionId?: string | null;
  navigateToSession?: (id: string) => void;
  showPin?: boolean;
  showCopy?: boolean;
  copyText?: string;
  pinText?: string;
  screenshotText?: string;
  inputText?: string;
  copyKind?: string;
}) {
  // Screenshots only ever capture markdown content, which must be supplied
  // explicitly (never the possibly-truncated raw tool.output).
  const markdownContent = screenshotText ?? pinText;

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {showPin && (pinText || tool.output) && onPin && (
        <>
          {markdownContent && (
            <MarkdownScreenshotButton
              content={markdownContent}
              className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPin(pinText ?? tool.output!);
            }}
            className="size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0"
            title="Pin as scratch note"
          >
            <Pin size={12} />
          </button>
        </>
      )}
      {childSessionId && navigateToSession && (
        <button
          type="button"
          className="shrink-0 px-2 py-1.5 text-[11px] font-medium text-accent hover:bg-ov-bg-hover cursor-pointer transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            navigateToSession(childSessionId);
          }}
        >
          <ArrowRightIcon size={12} className="inline" /> View session
        </button>
      )}
      {showCopy && (
        <ModeAwareCopyButton
          outputText={copyText ?? tool.output ?? ""}
          inputText={inputText}
          kind={copyKind}
        />
      )}
      {onBookmark && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBookmark();
          }}
          className={`size-5 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors shrink-0 ${isBookmarked ? "text-accent" : ""}`}
          title={isBookmarked ? "Remove bookmark" : "Bookmark"}
        >
          <Bookmark size={12} fill={isBookmarked ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}
