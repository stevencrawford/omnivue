import { toPng } from "html-to-image";

/** Rasterizes a DOM node to a PNG blob at retina resolution. */
export async function captureNodeToBlob(node: HTMLElement): Promise<Blob> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "transparent",
  });
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`screenshot capture failed: ${res.status}`);
  return res.blob();
}

/**
 * macOS-style screenshot filename with a timestamp so repeated captures never
 * collide, e.g. `Screenshot 2026-08-03 at 14.32.05.png`.
 */
export function screenshotFilename(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const timePart = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `Screenshot ${datePart} at ${timePart}.png`;
}

/** Triggers a browser download for the given blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
