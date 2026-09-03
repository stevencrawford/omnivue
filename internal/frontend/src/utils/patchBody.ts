/**
 * Helpers for the Codex/Copilot apply_patch dialect:
 *   *** Begin Patch
 *   *** Update File: <path>
 *   @@
 *    context
 *   - removed
 *   + added
 *   *** End Patch
 *
 * Backend strips these markers via ingestkit.ParseApplyPatch for Codex but
 * Copilot still stores raw patchText with markers. Frontend must handle both.
 * Multi-file patches (multiple *** Update File blocks inside one Begin/End)
 * are split per file (user request Split).
 */

export function isPatchLike(text: string): boolean {
  if (!text) return false;
  if (text.includes("*** Begin Patch")) return true;
  return /^@@/m.test(text);
}

export function extractPatchBodies(text: string): Record<string, string> {
  if (!text) return {};
  const hasMarkers =
    text.includes("*** Begin Patch") ||
    text.includes("*** Update File:") ||
    text.includes("*** Add File:") ||
    text.includes("*** Modify File:") ||
    text.includes("--- Update File:") ||
    text.includes("--- Add File:") ||
    text.includes("--- Modify File:") ||
    text.includes("*** Chunk:");
  if (!hasMarkers) {
    return { "": text };
  }

  const bodies: Record<string, string> = {};
  let currentPath = "";
  let inPatch = false;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const body = buffer.join("\n").replace(/\n+$/, "");
    if (!body) {
      buffer = [];
      return;
    }
    const key = currentPath || "";
    bodies[key] = bodies[key] ? bodies[key] + "\n" + body : body;
    buffer = [];
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("*** Begin Patch")) {
      inPatch = true;
      continue;
    }
    if (trimmed.startsWith("*** End Patch")) {
      flush();
      inPatch = false;
      continue;
    }
    if (trimmed.startsWith("*** Add File: ")) {
      flush();
      currentPath = trimmed.slice("*** Add File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("*** Modify File: ")) {
      flush();
      currentPath = trimmed.slice("*** Modify File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("*** Update File: ")) {
      flush();
      currentPath = trimmed.slice("*** Update File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("--- Add File: ")) {
      flush();
      currentPath = trimmed.slice("--- Add File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("--- Modify File: ")) {
      flush();
      currentPath = trimmed.slice("--- Modify File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("--- Update File: ")) {
      flush();
      currentPath = trimmed.slice("--- Update File: ".length).trim();
      continue;
    }
    if (trimmed.startsWith("*** Chunk:")) {
      flush();
      const rest = trimmed.slice("*** Chunk:".length).trim();
      const idx = rest.indexOf(" : ");
      currentPath = idx > 0 ? rest.slice(0, idx).trim() : rest;
      continue;
    }

    if (inPatch) {
      // Only collect lines when we know the target file; if path not yet
      // set, keep buffering under "" and reassign once path appears.
      buffer.push(line);
    }
  }
  flush();

  // If we collected under "" but now have a path, move it.
  if (bodies[""] && currentPath && Object.keys(bodies).length === 1) {
    bodies[currentPath] = bodies[""];
    delete bodies[""];
  }

  // If still empty but we had plain @@ without Begin Patch wrapper, fallback.
  if (Object.keys(bodies).length === 0) {
    return { "": text };
  }

  // For entries still under "", try to keep them; caller will fallback to original filePath.
  return bodies;
}

export function extractPatchBody(text: string): string {
  const bodies = extractPatchBodies(text);
  const keys = Object.keys(bodies);
  if (keys.length === 0) return "";
  if (keys.length === 1) return bodies[keys[0]];
  return Object.values(bodies).join("\n");
}
