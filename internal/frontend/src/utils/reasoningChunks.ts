// Floor below which consecutive paragraphs are coalesced so a long thinking
// stream does not fragment into dozens of tiny blocks.
export const REASONING_CHUNK_MIN = 300;

// Hard cap per chunk; oversized paragraphs are force-split at word boundaries.
export const REASONING_CHUNK_MAX = 2500;

const BLANK_LINE_RE = /^\s*$/;

// Splits reasoning text into deterministic, size-bounded blocks so that a
// single long thinking stream is shown as multiple collapsible blocks instead
// of one growing block. Paragraph breaks (blank lines) start a new block once
// the current one has reached the floor; paragraphs longer than the cap are
// force-split at word boundaries. A pure wall of text with no paragraph breaks
// degrades to cap-sized splits. Deterministic: identical input always yields
// identical blocks, so re-chunking during a live stream stays stable.
export function splitReasoning(reasoning: string): string[] {
  const text = reasoning.trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const close = () => {
    if (current.length === 0) return;
    chunks.push(current.join("\n"));
    current = [];
    currentLen = 0;
  };

  for (const line of lines) {
    if (BLANK_LINE_RE.test(line)) {
      if (current.length > 0) {
        if (currentLen >= REASONING_CHUNK_MIN) {
          // A paragraph break is a natural thought boundary: close the current
          // block once it has reached the floor so short paragraphs coalesce.
          close();
        } else {
          // Still coalescing below the floor: keep the break as an empty line
          // so the chunk text keeps its original paragraph separation.
          current.push("");
        }
      }
      continue;
    }
    if (line.length > REASONING_CHUNK_MAX) {
      close();
      for (const piece of splitByMax(line, REASONING_CHUNK_MAX)) {
        chunks.push(piece);
      }
      continue;
    }
    const addLen = currentLen === 0 ? line.length : line.length + 1;
    if (currentLen > 0 && currentLen + addLen > REASONING_CHUNK_MAX) {
      close();
      current.push(line);
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += addLen;
    }
  }
  close();
  return chunks;
}

// Splits an oversized line into pieces no longer than max, breaking only at
// whitespace. A single word longer than max is kept whole.
function splitByMax(line: string, max: number): string[] {
  const pieces: string[] = [];
  let buf = "";
  for (const word of line.split(/\s+/)) {
    if (word === "") continue;
    if (buf === "") {
      buf = word;
    } else if (buf.length + 1 + word.length <= max) {
      buf += " " + word;
    } else {
      pieces.push(buf);
      buf = word;
    }
  }
  if (buf !== "") pieces.push(buf);
  return pieces;
}
