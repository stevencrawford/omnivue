import type { FileEdit } from "../hooks/useApi";
import { computeDiff } from "./diff";
import { detectLanguage } from "./detectLanguage";

export interface MergedFileDiff {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
  perHunkPatches: string[];
  perHunkMessageIndices: number[];
}

interface ExtractedHunk {
  deletionStart: number;
  deletionCount: number;
  additionStart: number;
  additionCount: number;
  lines: string[];
  messageIndex: number;
}

export interface FileTreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: FileTreeNode[];
  diff?: MergedFileDiff;
  depth: number;
}

export function extractHunks(
  _filePath: string,
  oldContent: string,
  newContent: string,
  _lang: string,
  messageIndex: number,
): ExtractedHunk[] {
  try {
    const hunks = computeDiff(oldContent, newContent);
    return hunks.map((h) => ({ ...h, messageIndex }));
  } catch {
    return [];
  }
}

export function mergeFileEdits(filePath: string, edits: FileEdit[]): MergedFileDiff {
  const allHunks: ExtractedHunk[] = [];
  let isNew = false;
  const lang = detectLanguage(filePath);

  for (const edit of edits) {
    const mi = edit.messageIndex ?? -1;
    const body = edit.newStr || edit.content || "";
    if (body && !edit.oldStr) {
      isNew = true;
      if (body.startsWith("@@")) {
        const lines = body.split("\n");
        allHunks.push({
          deletionStart: 0,
          deletionCount: 0,
          additionStart: 1,
          additionCount: 0,
          lines,
          messageIndex: mi,
        });
      } else {
        const lines = body.split("\n");
        const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
        if (count === 0) continue;
        const hunkLines: string[] = [`@@ -0,0 +1,${count} @@`];
        for (const l of lines.slice(0, count)) {
          hunkLines.push("+" + l);
        }
        allHunks.push({
          deletionStart: 0,
          deletionCount: 0,
          additionStart: 1,
          additionCount: count,
          lines: hunkLines,
          messageIndex: mi,
        });
      }
      continue;
    }

    if (!edit.oldStr && !edit.newStr) continue;

    const oldContent = edit.oldStr || "";
    const newContent = edit.newStr || edit.content || "";
    const hunks = extractHunks(filePath, oldContent, newContent, lang, mi);
    allHunks.push(...hunks);
  }

  allHunks.sort((a, b) => a.deletionStart - b.deletionStart);

  const merged = allHunks;

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const hunk of merged) {
    for (const line of hunk.lines) {
      if (line.startsWith("+") && !line.startsWith("++")) totalAdditions++;
      else if (line.startsWith("-") && !line.startsWith("--")) totalDeletions++;
    }
  }

  let patch = "";
  const perHunkPatches: string[] = [];
  const perHunkMessageIndices: number[] = [];
  if (merged.length > 0) {
    const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
    for (const hunk of merged) {
      const hunkPatch = header + hunk.lines.join("\n") + "\n";
      patch += hunk.lines.join("\n") + "\n";
      perHunkPatches.push(hunkPatch);
      perHunkMessageIndices.push(hunk.messageIndex);
    }
    patch = header + patch;
  }

  return {
    path: filePath,
    status: isNew ? "added" : "modified",
    additions: totalAdditions,
    deletions: totalDeletions,
    patch,
    perHunkPatches,
    perHunkMessageIndices,
  };
}

function flattenDirectoryChains(nodes: FileTreeNode[]): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      flattenDirectoryChains(node.children);

      while (node.children.length === 1 && node.children[0].isDirectory) {
        const child = node.children[0];
        node.name = node.name + "/" + child.name;
        node.fullPath = child.fullPath;
        node.children = child.children;
        for (const c of node.children) {
          c.depth = node.depth + 1;
        }
      }
    }
  }
}

export function buildFileTree(diffs: MergedFileDiff[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const diff of diffs) {
    const parts = diff.path.replace(/^\/+/, "").split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          fullPath,
          isDirectory: !isLast,
          children: [],
          depth: i,
        };
        current.push(existing);
      }

      if (isLast) {
        existing.isDirectory = false;
        existing.diff = diff;
      }

      current = existing.children;
    }
  }

  function sortNodes(nodes: FileTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  }

  sortNodes(root);
  flattenDirectoryChains(root);
  return root;
}

export const DIFF_STATUS_COLORS = {
  added: { text: "text-green-500", bg: "bg-green-500" },
  modified: { text: "text-yellow-500", bg: "bg-yellow-500" },
  deleted: { text: "text-red-500", bg: "bg-red-500" },
} as const;

export function computeFileStatus(diff?: MergedFileDiff): { letter: string; color: string } {
  if (!diff) return { letter: "", color: "" };
  switch (diff.status) {
    case "added":
      return { letter: "A", color: DIFF_STATUS_COLORS.added.text };
    case "deleted":
      return { letter: "D", color: DIFF_STATUS_COLORS.deleted.text };
    default:
      return { letter: "M", color: DIFF_STATUS_COLORS.modified.text };
  }
}

export function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function relativizePath(filePath: string, directory: string | undefined): string {
  if (!directory) return filePath;
  const dir = directory.endsWith("/") ? directory : directory + "/";
  if (filePath.startsWith(dir)) {
    return filePath.slice(dir.length);
  }
  return filePath;
}
