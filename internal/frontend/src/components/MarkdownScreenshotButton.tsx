import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera } from "lucide-react";
import { ScreenshotWindow } from "./ScreenshotWindow";
import { captureNodeToBlob, downloadBlob, screenshotFilename } from "../lib/screenshot";
import { useToast } from "../hooks/useToast";

interface MarkdownScreenshotButtonProps {
  content: string;
  title?: string;
  subtitle?: string;
  className?: string;
}

interface CaptureTarget {
  content: string;
  title?: string;
  subtitle?: string;
}

/** Waits for web fonts + a double frame so the capture node is fully painted. */
async function waitForPaint(): Promise<void> {
  await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );
}

export function MarkdownScreenshotButton({
  content,
  title,
  subtitle,
  className = "size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated",
}: MarkdownScreenshotButtonProps) {
  const [capture, setCapture] = useState<CaptureTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (!capture) return;
    let cancelled = false;
    (async () => {
      try {
        await waitForPaint();
        if (cancelled || !nodeRef.current) return;
        const blob = await captureNodeToBlob(nodeRef.current);
        if (cancelled) return;
        downloadBlob(blob, screenshotFilename());
        showToast("Screenshot saved");
      } catch {
        if (!cancelled) showToast("Screenshot failed");
      } finally {
        if (!cancelled) {
          setCapture(null);
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capture, showToast]);

  const handleClick = () => {
    if (busy) return;
    setBusy(true);
    setCapture({ content, title, subtitle });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={className}
        title="Screenshot"
        disabled={busy}
      >
        <Camera size={12} />
      </button>
      {capture &&
        createPortal(
          <ScreenshotWindow
            content={capture.content}
            title={capture.title}
            subtitle={capture.subtitle}
            innerRef={nodeRef}
          />,
          document.body,
        )}
    </>
  );
}
