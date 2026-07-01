import { useCallback, useState } from "react";

export interface PinMessageState {
  pinningContent: string | null;
  pinTitle: string;
  setPinTitle: (t: string) => void;
  handlePinMessage: (content: string) => void;
  handleConfirmPin: (onPin: (title: string, content: string) => Promise<void>) => void;
  handleCancelPin: () => void;
}

/**
 * Manages the "Pin Message" modal — title extraction from content,
 * open/close/confirm lifecycle. Delegates actual scratch file creation
 * to the caller via the onPin callback.
 */
export function usePinMessage(): PinMessageState {
  const [pinningContent, setPinningContent] = useState<string | null>(null);
  const [pinTitle, setPinTitle] = useState("");

  const handlePinMessage = useCallback((content: string) => {
    const firstLine = extractPinTitle(content);
    setPinTitle(firstLine);
    setPinningContent(content);
  }, []);

  const handleConfirmPin = useCallback(
    async (onPin: (title: string, content: string) => Promise<void>) => {
      if (!pinningContent) return;
      try {
        const title = pinTitle.trim() || "Pinned message";
        await onPin(title, pinningContent);
      } catch {
        /* ignore */
      } finally {
        setPinningContent(null);
        setPinTitle("");
      }
    },
    [pinningContent, pinTitle],
  );

  const handleCancelPin = useCallback(() => {
    setPinningContent(null);
    setPinTitle("");
  }, []);

  return {
    pinningContent,
    pinTitle,
    setPinTitle,
    handlePinMessage,
    handleConfirmPin,
    handleCancelPin,
  };
}

/** Extract a display title from the first heading or first content line. */
function extractPinTitle(content: string): string {
  for (const line of content.split("\n")) {
    const t = line.trim();
    const h1 = t.match(/^#\s+(.+)/);
    if (h1) return h1[1].trim();
  }
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("```")) {
      const cleaned = t.replace(/^#+\s*/, "");
      return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
    }
  }
  return "Pinned message";
}
