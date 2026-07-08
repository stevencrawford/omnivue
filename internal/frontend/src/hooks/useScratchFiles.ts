import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect } from "effect";
import type { ScratchFile, Session } from "./types";
import { ScratchService, ApiError } from "../services";
import { runPromise } from "../lib/effect";

export interface ScratchFileInfo {
  title: string;
  mode: string;
  sessionId: string;
}

export interface ScratchFilesState {
  scratchFiles: ScratchFile[];
  openScratchTabs: string[];
  scratchFileMap: Record<string, ScratchFileInfo>;
  loadScratchFiles: () => Promise<void>;
  handleNewScratchFile: () => Promise<void>;
  handleCloseScratchTab: (fileId: string) => void;
  handleRenameScratchFile: (fileId: string, newTitle: string) => Promise<void>;
  handlePinAsScratch: (title: string, content: string) => Promise<void>;
}

function listAllScratchFilesEffect() {
  return ScratchService.pipe(
    Effect.flatMap((svc) => svc.listAll()),
    Effect.catchAll((err: ApiError) => {
      console.error("[scratch] failed to load:", err.message);
      return Effect.succeed([] as ScratchFile[]);
    }),
  );
}

function createScratchFileEffect(
  sessionId: string,
  title: string,
  content?: string,
  mode?: "writable" | "readonly",
) {
  return ScratchService.pipe(
    Effect.flatMap((svc) => svc.create(sessionId, title, content, mode)),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to create scratch file:", err.message)),
    ),
  );
}

function renameScratchFileEffect(sessionId: string, fileId: string, newTitle: string) {
  return ScratchService.pipe(
    Effect.flatMap((svc) => svc.rename(sessionId, fileId, newTitle)),
    Effect.catchAll((err: ApiError) =>
      Effect.sync(() => console.error("Failed to rename scratch file:", err.message)),
    ),
  );
}

export function useScratchFiles(
  sessions: Session[],
  activeSessionId: string | null,
  activeTab: string,
  activeSession: Session | null,
  setActiveTab: (tab: string) => void,
): ScratchFilesState {
  const [scratchFiles, setScratchFiles] = useState<ScratchFile[]>([]);
  const [openScratchTabs, setOpenScratchTabs] = useState<string[]>([]);

  const sessionIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);

  const validScratchFiles = useMemo(
    () => scratchFiles.filter((f) => sessionIds.has(f.sessionId)),
    [scratchFiles, sessionIds],
  );

  const scratchFileMap = useMemo(() => {
    const map: Record<string, ScratchFileInfo> = {};
    for (const f of validScratchFiles) {
      map[f.id] = { title: f.title, mode: f.mode, sessionId: f.sessionId };
    }
    return map;
  }, [validScratchFiles]);

  const loadScratchFiles = useCallback(async () => {
    try {
      const data = await runPromise(listAllScratchFilesEffect());
      setScratchFiles(data ?? []);
    } catch {
      setScratchFiles([]);
    }
  }, []);

  useEffect(() => {
    loadScratchFiles();
  }, [loadScratchFiles]);

  // Auto-open scratch tabs when switching to a session
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (prevSessionIdRef.current === activeSessionId) return;
    prevSessionIdRef.current = activeSessionId;
    const sessionFileIds = validScratchFiles
      .filter((f) => f.sessionId === activeSessionId)
      .map((f) => f.id);
    setOpenScratchTabs(sessionFileIds);
  }, [activeSessionId, validScratchFiles]);

  const handleNewScratchFile = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const f = await runPromise(
        createScratchFileEffect(activeSessionId, "Untitled", "# Untitled"),
      );
      setScratchFiles((prev) => [f, ...prev]);
      setOpenScratchTabs((prev) => [...prev, f.id]);
      setActiveTab(`scratch:${f.id}`);
    } catch {
      /* ignore */
    }
  }, [activeSessionId, setActiveTab]);

  const handleCloseScratchTab = useCallback(
    (fileId: string) => {
      setOpenScratchTabs((prev) => prev.filter((id) => id !== fileId));
      const tab = `scratch:${fileId}`;
      if (activeTab === tab && activeSession) {
        setActiveTab("session");
      }
    },
    [activeTab, activeSession, setActiveTab],
  );

  const handleRenameScratchFile = useCallback(
    async (fileId: string, newTitle: string) => {
      const info = scratchFileMap[fileId];
      if (!info) return;
      try {
        await runPromise(renameScratchFileEffect(info.sessionId, fileId, newTitle));
        setScratchFiles((prev) =>
          prev.map((f) => (f.id === fileId ? { ...f, title: newTitle } : f)),
        );
      } catch {
        /* ignore */
      }
    },
    [scratchFileMap],
  );

  const handlePinAsScratch = useCallback(
    async (title: string, content: string) => {
      if (!activeSessionId) return;
      try {
        const f = await runPromise(
          createScratchFileEffect(activeSessionId, title, content, "readonly"),
        );
        setScratchFiles((prev) => [f, ...prev]);
        setOpenScratchTabs((prev) => (prev.includes(f.id) ? prev : [...prev, f.id]));
        setActiveTab(`scratch:${f.id}`);
      } catch {
        /* ignore */
      }
    },
    [activeSessionId, setActiveTab],
  );

  return {
    scratchFiles,
    openScratchTabs,
    scratchFileMap,
    loadScratchFiles,
    handleNewScratchFile,
    handleCloseScratchTab,
    handleRenameScratchFile,
    handlePinAsScratch,
  };
}
