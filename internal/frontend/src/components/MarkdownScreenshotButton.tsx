import { useState } from "react";
import { Camera } from "lucide-react";
import { ScreenshotCaptureLayer } from "./ScreenshotCaptureLayer";
import { downloadBlob, screenshotFilename } from "../lib/screenshot";
import { useToast } from "../hooks/useToast";

interface MarkdownScreenshotButtonProps {
  content: string;
  title?: string;
  subtitle?: string;
  className?: string;
}

/**
 * Renders a camera button that captures the markdown as a macOS-style window
 * screenshot and immediately downloads it (like a native macOS screenshot).
 */
export function MarkdownScreenshotButton({
  content,
  title,
  subtitle,
  className = "size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer border border-ov-border bg-surface-elevated",
}: MarkdownScreenshotButtonProps) {
  const [capturing, setCapturing] = useState(false);
  const { showToast } = useToast();

  const handleComplete = (blob: Blob) => {
    setCapturing(false);
    try {
      downloadBlob(blob, screenshotFilename());
    } catch {
      showToast("Screenshot failed");
    }
  };

  const handleError = () => {
    setCapturing(false);
    showToast("Screenshot failed");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setCapturing(true)}
        className={className}
        title="Screenshot"
        disabled={capturing}
      >
        <Camera size={12} />
      </button>
      {capturing && (
        <ScreenshotCaptureLayer
          content={content}
          title={title}
          subtitle={subtitle}
          onComplete={handleComplete}
          onError={handleError}
        />
      )}
    </>
  );
}
