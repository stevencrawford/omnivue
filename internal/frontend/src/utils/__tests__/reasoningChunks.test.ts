import { describe, expect, it } from "vitest";
import { REASONING_CHUNK_MAX, REASONING_CHUNK_MIN, splitReasoning } from "../reasoningChunks";

describe("splitReasoning", () => {
  it("returns empty for empty or whitespace-only input", () => {
    expect(splitReasoning("")).toEqual([]);
    expect(splitReasoning("   \n  ")).toEqual([]);
  });

  it("is deterministic for identical input", () => {
    const reasoning = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    expect(splitReasoning(reasoning)).toEqual(splitReasoning(reasoning));
  });

  it("keeps short reasoning as a single block", () => {
    const reasoning = "Short thought.";
    expect(splitReasoning(reasoning)).toEqual(["Short thought."]);
  });

  it("splits at paragraph breaks once the floor is reached", () => {
    const short = "p".repeat(REASONING_CHUNK_MIN - 100);
    const reasoning = [short, short, short, short].join("\n\n");
    const chunks = splitReasoning(reasoning);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${short}\n\n${short}`);
    expect(chunks[1]).toBe(`${short}\n\n${short}`);
  });

  it("coalesces consecutive short paragraphs below the floor", () => {
    const short = "short";
    const reasoning = [short, short, short, short, short].join("\n\n");
    const chunks = splitReasoning(reasoning);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(reasoning);
  });

  it("force-splits a paragraph longer than the cap at word boundaries", () => {
    const word = "word ";
    const line = word.repeat(Math.ceil(REASONING_CHUNK_MAX / word.length) + 2);
    const chunks = splitReasoning(line);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(REASONING_CHUNK_MAX + word.length);
      expect(chunk.startsWith("word")).toBe(true);
    }
    expect(chunks.join(" ")).toBe(line.trim());
  });

  it("never exceeds the cap when paragraphs flow without breaks", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i} `.repeat(20));
    const reasoning = lines.join("\n");
    const chunks = splitReasoning(reasoning);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(REASONING_CHUNK_MAX);
    }
    expect(chunks.join("\n")).toBe(reasoning.trim());
  });

  it("handles CRLF line endings", () => {
    const para = "p".repeat(REASONING_CHUNK_MIN);
    const reasoning = `${para}\r\n\r\n${para}`;
    const chunks = splitReasoning(reasoning);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para);
    expect(chunks[1]).toBe(para);
  });
});
