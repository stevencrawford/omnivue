import type { SearchResult } from "../hooks/types";

export interface SearchSection {
  chunkType: string;
  label: string;
  badge: string;
  results: SearchResult[];
  globalStartIndex: number;
}

const CHUNK_LABELS: Record<string, { label: string; badge: string }> = {
  tag: {
    label: "Tags",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  name: { label: "Session Name", badge: "bg-accent-muted text-accent border-accent-border" },
  plan: {
    label: "Plan Content",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  message: {
    label: "Session Messages",
    badge: "bg-ov-bg-hover text-ov-text-secondary border-ov-border",
  },
  messages: {
    label: "Session Messages",
    badge: "bg-ov-bg-hover text-ov-text-secondary border-ov-border",
  },
  scratch: {
    label: "Scratch Notes",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
};

const SECTION_ORDER = ["tag", "name", "plan", "message", "scratch"];

/** Groups flat search results into labelled, ordered sections with a running index. */
export function groupSearchSections(results: SearchResult[]): SearchSection[] {
  const groups = new Map<string, SearchResult[]>();
  for (const r of results) {
    const ct = r.chunkType === "messages" ? "message" : r.chunkType || "message";
    if (!groups.has(ct)) groups.set(ct, []);
    groups.get(ct)!.push(r);
  }
  const out: SearchSection[] = [];
  let globalIdx = 0;
  for (const ct of SECTION_ORDER) {
    const group = groups.get(ct);
    if (!group || group.length === 0) continue;
    const meta = CHUNK_LABELS[ct] || {
      label: ct,
      badge: "bg-ov-bg-hover text-ov-text-secondary border-ov-border",
    };
    out.push({ chunkType: ct, ...meta, results: group, globalStartIndex: globalIdx });
    globalIdx += group.length;
  }
  return out;
}
