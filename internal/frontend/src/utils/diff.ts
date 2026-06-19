import { diffLines } from "diff";

export interface DiffHunk {
  deletionStart: number;
  deletionCount: number;
  additionStart: number;
  additionCount: number;
  lines: string[];
}

export function computeDiff(oldContent: string, newContent: string): DiffHunk[] {
  if (oldContent === newContent) return [];

  const changes = diffLines(oldContent, newContent);

  type AnnotatedLine = {
    text: string;
    type: "ctx" | "add" | "del";
    oldLine: number;
    newLine: number;
  };

  const allLines: AnnotatedLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const raw = change.value;
    const lines = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
    const actualLines = lines.length === 1 && lines[0] === "" && raw.endsWith("\n") ? [] : lines;

    if (change.added && !change.removed) {
      for (const line of actualLines) {
        allLines.push({ text: line, type: "add", oldLine: 0, newLine: newLineNum });
        newLineNum++;
      }
    } else if (change.removed && !change.added) {
      for (const line of actualLines) {
        allLines.push({ text: line, type: "del", oldLine: oldLineNum, newLine: 0 });
        oldLineNum++;
      }
    } else {
      for (const line of actualLines) {
        allLines.push({ text: line, type: "ctx", oldLine: oldLineNum, newLine: newLineNum });
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
      if (allLines[j].type !== "ctx") { j++; continue; }
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

    const first = hunkSlice.find(l => l.type !== "ctx") ?? hunkSlice[0];
    const deletionStart = first.type !== "add" ? (first.oldLine || 1) : 0;
    const additionStart = first.type !== "del" ? (first.newLine || 1) : 0;

    const lineStrings: string[] = [];
    let oldCount = 0;
    let newCount = 0;

    for (const hl of hunkSlice) {
      if (hl.type === "del") {
        lineStrings.push("-" + hl.text);
        oldCount++;
      } else if (hl.type === "add") {
        lineStrings.push("+" + hl.text);
        newCount++;
      } else {
        lineStrings.push(" " + hl.text);
        oldCount++;
        newCount++;
      }
    }

    const header = `@@ -${deletionStart},${oldCount} +${additionStart},${newCount} @@`;
    lineStrings.unshift(header);

    hunks.push({
      deletionStart,
      deletionCount: oldCount,
      additionStart,
      additionCount: newCount,
      lines: lineStrings,
    });

    i = hunkEndIdx;
  }

  return hunks;
}
