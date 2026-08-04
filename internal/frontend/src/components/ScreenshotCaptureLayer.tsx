import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ScreenshotWindow } from "./ScreenshotWindow";
import { captureNodeToBlob, capturePrep } from "../lib/screenshot";

interface ScreenshotCaptureLayerProps {
  content: string;
  title?: string;
  subtitle?: string;
  onComplete: (blob: Blob) => void;
  onError: () => void;
}

const STYLE_WAIT_MS = 2000;
const CAPTURE_MS = 30000;

/** Resolves after `ms` even if `promise` never settles, so the UI can never hang. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<T | undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** Copies the app's stylesheets + theme into the capture document so it renders identically. */
function copyStyles(source: Document, target: HTMLHeadElement): void {
  source.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    if (!(link instanceof HTMLLinkElement)) return;
    const clone = document.createElement("link");
    clone.rel = "stylesheet";
    clone.referrerPolicy = link.referrerPolicy;
    clone.href = link.href;
    target.appendChild(clone);
  });
  source.querySelectorAll("style").forEach((style) => {
    target.appendChild(style.cloneNode(true));
  });
}

/** Copies the html-level attributes that drive theming (palette + light/dark). */
function copyDocumentAttrs(source: HTMLElement, target: HTMLElement): void {
  if (source.hasAttribute("data-theme")) {
    target.setAttribute("data-theme", source.getAttribute("data-theme")!);
  }
  if (source.hasAttribute("data-mode")) {
    target.setAttribute("data-mode", source.getAttribute("data-mode")!);
  }
  if (typeof source.className === "string" && source.className) {
    target.className = source.className;
  }
}

function waitForPaint(doc: Document): Promise<void> {
  const fonts = doc.fonts ? doc.fonts.ready.then(() => undefined) : Promise.resolve();
  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((link) =>
    (link as HTMLLinkElement).sheet
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          link.addEventListener("load", () => resolve(), { once: true });
          link.addEventListener("error", () => resolve(), { once: true });
        }),
  );
  return withTimeout(Promise.all([fonts, ...links]), STYLE_WAIT_MS).then(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Captures a macOS-style window screenshot by rendering the content into a
 * hidden same-origin iframe that sits behind the app UI (z-index -1) so nothing
 * flashes on screen, then rasterizes it with html-to-image.
 */
export function ScreenshotCaptureLayer({
  content,
  title,
  subtitle,
  onComplete,
  onError,
}: ScreenshotCaptureLayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;
    doneRef.current = false;

    const timeout = setTimeout(() => {
      if (!cancelled && !doneRef.current) {
        doneRef.current = true;
        onError();
      }
    }, CAPTURE_MS);

    (async () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) throw new Error("capture document unavailable");
        doc.open();
        doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
        doc.close();
        copyDocumentAttrs(document.documentElement, doc.documentElement);
        copyStyles(document, doc.head);
        const root = createRoot(doc.body);
        rootRef.current = root;
        root.render(<ScreenshotWindow content={content} title={title} subtitle={subtitle} />);

        await waitForPaint(doc);
        if (cancelled) return;

        const node = doc.querySelector<HTMLElement>("[data-screenshot-window]");
        if (!node) throw new Error("capture node not found");
        capturePrep(node);
        const blob = await withTimeout(captureNodeToBlob(node), CAPTURE_MS);
        if (cancelled || doneRef.current) return;
        if (!blob) throw new Error("capture timed out");
        doneRef.current = true;
        clearTimeout(timeout);
        onComplete(blob);
      } catch {
        if (!cancelled && !doneRef.current) {
          doneRef.current = true;
          clearTimeout(timeout);
          onError();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rootRef.current) {
        rootRef.current.unmount();
        rootRef.current = null;
      }
      iframe.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, title, subtitle]);

  return createPortal(
    <iframe
      ref={iframeRef}
      src="about:blank"
      title="screenshot-capture"
      aria-hidden="true"
      tabIndex={-1}
      className="fixed left-0 top-0 w-[1140px] border-0"
      style={{ zIndex: -1, pointerEvents: "none" }}
    />,
    document.body,
  );
}
