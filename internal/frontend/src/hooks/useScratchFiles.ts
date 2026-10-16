import { useCallback } from "react";
import type { ScratchFile } from "./types";
import { createScratchFile } from "./apiClient";

export interface ScratchFilesState {
  /**
   * Create a read-only scratch file from pinned message content. Returns the
   * created file (so the caller can focus it) or null when there is no active
   * session or the request fails.
   */
  handlePinAsScratch: (title: string, content: string) => Promise<ScratchFile | null>;
}

/**
 * Scratch files are owned by the cinematic session view (its file tree and
 * editor). The only app-level scratch action is pinning a message into a new
 * read-only scratch file, which the modal in `App.tsx` drives.
 */
export function useScratchFiles(activeSessionId: string | null): ScratchFilesState {
  const handlePinAsScratch = useCallback(
    async (title: string, content: string): Promise<ScratchFile | null> => {
      if (!activeSessionId) return null;
      try {
        return await createScratchFile(activeSessionId, title, content, "readonly");
      } catch {
        return null;
      }
    },
    [activeSessionId],
  );

  return { handlePinAsScratch };
}
