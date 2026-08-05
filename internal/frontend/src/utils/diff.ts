import { diffLines } from "diff";

export type DiffLineType = "ctx" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldLine: number;
  newLine: number;
}

export interface DiffHunk {
  deletionStart: number;
  deletionCount: number;
  additionStart: number;
  additionCount: number;
  lines: DiffLine[];
}

export interface RenderRow {
  kind: DiffLineType | "header";
  prefix: string;
  text: string;
  oldNum: string;
  newNum: string;
}

export function computeDiff(oldContent: string, newContent: string): DiffHunk[] {
  if (oldContent === newContent) return [];

  const changes = diffLines(oldContent, newContent);

  const allLines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const raw = change.value;
    const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
    const actualLines = lines.length === 1 && lines[0] === "" && raw.endsWith("\n") ? [] : lines;

    if (change.added && !change.removed) {
      for (const line of actualLines) {
        allLines.push({ type: "add", text: line, oldLine: 0, newLine: newLineNum });
        newLineNum++;
      }
    } else if (change.removed && !change.added) {
      for (const line of actualLines) {
        allLines.push({ type: "del", text: line, oldLine: oldLineNum, newLine: 0 });
        oldLineNum++;
      }
    } else {
      for (const line of actualLines) {
        allLines.push({ type: "ctx", text: line, oldLine: oldLineNum, newLine: newLineNum });
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  if (allLines.length === 0) return [];

  const CONTEXT = 3;
  const hunks: DiffHunk[] = [];
  let i = 0;

  while (i < allLines.length) {
    while (i < allLines.length && allLines[i].type === "ctx") i++;
    if (i >= allLines.length) break;

    const hunkStartIdx = Math.max(0, i - CONTEXT);
    let j = i;

    while (j < allLines.length) {
      if (allLines[j].type !== "ctx") {
        j++;
        continue;
      }
      let nextChange = j;
      while (nextChange < allLines.length && allLines[nextChange].type === "ctx") nextChange++;
      if (nextChange >= allLines.length) break;
      if (nextChange - j <= CONTEXT * 2) {
        j = nextChange;
      } else {
        j += CONTEXT;
        break;
      }
    }

    const hunkEndIdx = Math.min(allLines.length, j + CONTEXT);
    const hunkSlice = allLines.slice(hunkStartIdx, hunkEndIdx);

    const first = hunkSlice.find((l) => l.type !== "ctx") ?? hunkSlice[0];
    const deletionStart = first.type !== "add" ? first.oldLine || 1 : 0;
    const additionStart = first.type !== "del" ? first.newLine || 1 : 0;

    let oldCount = 0;
    let newCount = 0;
    for (const line of hunkSlice) {
      if (line.type !== "add") oldCount++;
      if (line.type !== "del") newCount++;
    }

    hunks.push({
      deletionStart,
      deletionCount: oldCount,
      additionStart,
      additionCount: newCount,
      lines: hunkSlice,
    });

    i = hunkEndIdx;
  }

  return hunks;
}

function headerFor(hunk: DiffHunk): string {
  return `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
}

function prefixOf(type: DiffLineType): string {
  return type === "add" ? "+" : type === "del" ? "-" : " ";
}

/** renderHunk turns a structured hunk into display rows (line numbers resolved). */
export function renderHunk(hunk: DiffHunk): RenderRow[] {
  let oldLine = hunk.deletionStart - 1;
  let newLine = hunk.additionStart - 1;

  const rows: RenderRow[] = [
    { kind: "header", prefix: "", text: headerFor(hunk), oldNum: "", newNum: "" },
  ];

  for (const line of hunk.lines) {
    if (line.type === "add") {
      newLine++;
      rows.push({ kind: "add", prefix: "+", text: line.text, oldNum: "", newNum: String(newLine) });
    } else if (line.type === "del") {
      oldLine++;
      rows.push({ kind: "del", prefix: "-", text: line.text, oldNum: String(oldLine), newNum: "" });
    } else {
      oldLine++;
      newLine++;
      rows.push({
        kind: "ctx",
        prefix: " ",
        text: line.text,
        oldNum: String(oldLine),
        newNum: String(newLine),
      });
    }
  }

  return rows;
}

/**
 * serializeUnifiedDiff is the single leaf that renders structured hunks to
 * unified-diff text with a `--- a/…` / `+++ b/…` file header. Use it only where
 * diff text must leave the module (copy/export); everything else renders the
 * structure directly.
 */
export function serializeUnifiedDiff(hunks: DiffHunk[], options?: { filePath?: string }): string {
  const parts: string[] = [];
  if (options?.filePath) {
    parts.push(`--- a/${options.filePath}`, `+++ b/${options.filePath}`);
  }
  for (const hunk of hunks) {
    parts.push(headerFor(hunk));
    for (const line of hunk.lines) {
      parts.push(prefixOf(line.type) + line.text);
    }
  }
  return parts.join("\n") + "\n";
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * parseUnifiedDiff turns unified-diff text into structured hunks. It is the
 * leaf used at the data boundary when an adapter's tool output is already a
 * unified diff; no component re-parses diff text.
 */
export function parseUnifiedDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith("---") || line.startsWith("+++")) continue;

    const header = line.match(HUNK_HEADER_RE);
    if (header) {
      if (current) hunks.push(current);
      const deletionStart = Number(header[1]);
      const additionStart = Number(header[3]);
      oldLine = deletionStart - 1;
      newLine = additionStart - 1;
      current = {
        deletionStart,
        deletionCount: header[2] ? Number(header[2]) : 1,
        additionStart,
        additionCount: header[4] ? Number(header[4]) : 1,
        lines: [],
      };
      continue;
    }

    if (!current) continue;
    if (line === "") continue;

    const prefix = line.charAt(0);
    const content = line.slice(1);
    if (prefix === "+") {
      newLine++;
      current.lines.push({ type: "add", text: content, oldLine: 0, newLine });
    } else if (prefix === "-") {
      oldLine++;
      current.lines.push({ type: "del", text: content, oldLine, newLine: 0 });
    } else {
      oldLine++;
      newLine++;
      current.lines.push({ type: "ctx", text: content, oldLine, newLine });
    }
  }

  if (current) hunks.push(current);
  return hunks;
}
