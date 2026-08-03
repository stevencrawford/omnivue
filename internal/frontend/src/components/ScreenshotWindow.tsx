import type { Ref } from "react";
import { MarkdownContent } from "./MarkdownContent";

interface ScreenshotWindowProps {
  content: string;
  title?: string;
  subtitle?: string;
  /**
   * Ref to the capture root. Rendered on-screen (inside a short-lived overlay)
   * because html-to-image cannot rasterize offscreen nodes, and any background
   * must live on an inner child — html-to-image drops a background applied to
   * the captured node itself.
   */
  innerRef?: Ref<HTMLDivElement>;
}

/**
 * macOS-style window chrome used only as the capture target for markdown
 * screenshots. Colors resolve from the current theme at capture time.
 */
export function ScreenshotWindow({ content, title, subtitle, innerRef }: ScreenshotWindowProps) {
  return (
    <div ref={innerRef} className="w-[760px]" data-screenshot-window aria-hidden="true">
      <div className="bg-surface-elevated rounded-2xl border border-ov-border shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--color-ov-bg-secondary)] border-b border-ov-border">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex-1 text-center">
            <span className="text-[11px] font-mono text-ov-text-secondary truncate">
              {title || "Omnivue"}
            </span>
          </div>
          <div className="w-14" />
        </div>
        <div className="px-6 py-5">
          {subtitle && (
            <div className="text-[11px] font-semibold text-ov-text-secondary/60 uppercase tracking-wider mb-2">
              {subtitle}
            </div>
          )}
          <MarkdownContent content={content} className="markdown-body--wide" hideCopy />
        </div>
      </div>
    </div>
  );
}
