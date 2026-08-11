import { describe, expect, it } from "vitest";
import { screenshotFilename } from "../screenshot";

describe("screenshotFilename", () => {
  it("uses the macOS-style timestamp format", () => {
    const d = new Date(2026, 7, 3, 14, 32, 5);
    expect(screenshotFilename(d)).toBe("Screenshot 2026-08-03 at 14.32.05.png");
  });

  it("pads single-digit components", () => {
    const d = new Date(2026, 0, 9, 9, 5, 7);
    expect(screenshotFilename(d)).toBe("Screenshot 2026-01-09 at 09.05.07.png");
  });

  it("produces distinct names across seconds", () => {
    const a = new Date(2026, 7, 3, 14, 32, 5);
    const b = new Date(2026, 7, 3, 14, 32, 6);
    expect(screenshotFilename(a)).not.toBe(screenshotFilename(b));
  });
});
