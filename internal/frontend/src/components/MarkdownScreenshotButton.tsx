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

const OVERLAY_LABEL = "Capturing screenshot…";
const VIEW_URL_LIFETIME_MS = 60000;

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
        const filename = screenshotFilename();
        downloadBlob(blob, filename);
        const viewUrl = URL.createObjectURL(blob);
        showToast("Screenshot saved", {
          label: "View",
          onClick: () => window.open(viewUrl, "_blank", "noopener"),
        });
        setTimeout(() => URL.revokeObjectURL(viewUrl), VIEW_URL_LIFETIME_MS);
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
          <div className="fixed inset-0 z-[9999]" data-screenshot-overlay>
            <div className="fixed inset-0 bg-black/40" />
            <div className="relative flex justify-center pt-[5vh]">
              <ScreenshotWindow
                content={capture.content}
                title={capture.title}
                subtitle={capture.subtitle}
                innerRef={nodeRef}
              />
            </div>
            <div className="fixed bottom-6 inset-x-0 text-center text-xs text-white/80">
              {OVERLAY_LABEL}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
