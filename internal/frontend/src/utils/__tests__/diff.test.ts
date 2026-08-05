import { describe, expect, it } from "vitest";
import { computeDiff, renderHunk, serializeUnifiedDiff, parseUnifiedDiff } from "../diff";
import { mergeFileEdits } from "../diffTree";
import type { FileEdit } from "../../hooks/types";

describe("computeDiff", () => {
  it("returns [] for identical content", () => {
    expect(computeDiff("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("produces a single structured hunk for a one-line edit", () => {
    const hunks = computeDiff("a\nb\nc\n", "a\nX\nc\n");
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    expect(hunk.lines.map((l) => l.type)).toEqual(["ctx", "del", "add", "ctx"]);
    expect(hunk.lines.map((l) => l.text)).toEqual(["a", "b", "X", "c"]);
    expect(hunk.lines[0]).toEqual({ type: "ctx", text: "a", oldLine: 1, newLine: 1 });
    expect(hunk.lines[1]).toEqual({ type: "del", text: "b", oldLine: 2, newLine: 0 });
    expect(hunk.lines[2]).toEqual({ type: "add", text: "X", oldLine: 0, newLine: 2 });
  });

  it("treats a wholly-new file as an all-add hunk", () => {
    const hunks = computeDiff("", "x\ny\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((l) => l.type)).toEqual(["add", "add"]);
    expect(hunks[0].additionStart).toBe(1);
    expect(hunks[0].deletionStart).toBe(0);
  });

  it("splits far-apart changes into separate hunks", () => {
    const oldContent = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n");
    const newContent = oldContent.replace("line5", "CHANGED5").replace("line18", "CHANGED18");
    const hunks = computeDiff(oldContent, newContent);
    expect(hunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderHunk", () => {
  it("renders header + numbered lines", () => {
    const hunks = computeDiff("a\nb\nc\n", "a\nX\nc\n");
    const rows = renderHunk(hunks[0]);
    expect(rows[0]).toEqual({
      kind: "header",
      prefix: "",
      text: expect.stringMatching(/^@@ /),
      oldNum: "",
      newNum: "",
    });
    expect(rows.slice(1).map((r) => r.kind)).toEqual(["ctx", "del", "add", "ctx"]);
    // Line numbers derive from the hunk header start, mirroring the legacy
    // unified-diff text renderer (leading context inherits the start offset).
    expect(rows[1]).toMatchObject({ kind: "ctx", text: "a", oldNum: "2", newNum: "0" });
    expect(rows[2]).toMatchObject({ kind: "del", text: "b", oldNum: "3", newNum: "" });
    expect(rows[3]).toMatchObject({ kind: "add", text: "X", oldNum: "", newNum: "1" });
  });
});

describe("serialize/parse round trip", () => {
  it("reconstructs equivalent hunks from text", () => {
    const text = ["--- a/f.ts", "+++ b/f.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+X", " c", ""].join(
      "\n",
    );
    const hunks = parseUnifiedDiff(text);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].deletionStart).toBe(1);
    expect(hunks[0].additionStart).toBe(1);
    expect(hunks[0].lines.map((l) => [l.type, l.text])).toEqual([
      ["ctx", "a"],
      ["del", "b"],
      ["add", "X"],
      ["ctx", "c"],
    ]);

    const reparsed = parseUnifiedDiff(serializeUnifiedDiff(hunks, { filePath: "f.ts" }));
    expect(reparsed).toEqual(hunks);
  });

  it("handles count-less hunk headers", () => {
    const hunks = parseUnifiedDiff("@@ -2 +2 @@\n-b\n+X\n");
    expect(hunks[0].deletionCount).toBe(1);
    expect(hunks[0].additionCount).toBe(1);
  });
});

describe("mergeFileEdits", () => {
  const edit = (overrides: Partial<FileEdit>): FileEdit =>
    ({
      filePath: "src/a.ts",
      toolName: "edit",
      oldStr: "",
      newStr: "",
      content: "",
      messageIndex: 0,
      timestamp: "2024-01-01T00:00:00Z",
      ...overrides,
    }) as FileEdit;

  it("merges an edit into structured hunks with stats", () => {
    const merged = mergeFileEdits("src/a.ts", [
      edit({ oldStr: "b\n", newStr: "X\n", messageIndex: 3 }),
    ]);
    expect(merged.path).toBe("src/a.ts");
    expect(merged.status).toBe("modified");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].messageIndex).toBe(3);
    expect(merged.additions).toBe(1);
    expect(merged.deletions).toBe(1);
  });

  it("marks a write edit as added with an all-add hunk", () => {
    const merged = mergeFileEdits("src/new.ts", [edit({ newStr: "x\ny\n", messageIndex: 0 })]);
    expect(merged.status).toBe("added");
    expect(merged.hunks[0].lines.map((l) => l.type)).toEqual(["add", "add"]);
    expect(merged.additions).toBe(2);
  });

  it("parses edit content that is already a unified diff", () => {
    const body = "@@ -1,2 +1,2 @@\n-a\n+b\n";
    const merged = mergeFileEdits("src/a.ts", [edit({ newStr: body, messageIndex: 1 })]);
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].lines.map((l) => [l.type, l.text])).toEqual([
      ["del", "a"],
      ["add", "b"],
    ]);
    expect(merged.hunks[0].messageIndex).toBe(1);
  });

  it("sorts hunks by deletion start while keeping message indices", () => {
    const merged = mergeFileEdits("src/a.ts", [
      edit({ oldStr: "keep\nchange\n", newStr: "keep\nX\n", messageIndex: 4 }),
      edit({ oldStr: "change2\n", newStr: "Y\n", messageIndex: 2 }),
    ]);
    expect(merged.hunks.map((h) => h.messageIndex)).toEqual([2, 4]);
  });

  it("returns an empty hunk list for empty edits", () => {
    const merged = mergeFileEdits("src/a.ts", [edit({})]);
    expect(merged.hunks).toHaveLength(0);
    expect(merged.additions).toBe(0);
    expect(merged.deletions).toBe(0);
  });
});
