// API client functions for the Omnivue frontend.
// All functions return typed promises with runtime validation via Zod.

import { z, type ZodType } from "zod/v4";
import type {
  Session,
  Source,
  Message,
  Plan,
  DiffFile,
  FileEdit,
  ScratchFile,
  StatusInfo,
  SearchResult,
  Folder,
  Bookmark,
} from "./types";
import {
  SessionsSchema,
  MessagesSchema,
  PlanSchema,
  DiffsSchema,
  FileEditsSchema,
  ScratchFileSchema,
  ScratchFilesSchema,
  StatusInfoSchema,
  SearchResultsSchema,
  SourcesSchema,
  SourceSchema,
  FoldersSchema,
  FolderSchema,
  FolderSessionsSchema,
  BookmarksSchema,
  BookmarkToggleSchema,
  ConfigSchema,
  ResumeCommandSchema,
  SessionSchema,
} from "./schemas";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

class ApiError extends Error {
  status: number;
  endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

async function fetchJson<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    // Re-throw AbortError so callers can check signal.aborted
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Network error: ${String(err)}`, 0, url);
  }
  if (!res.ok) {
    throw new ApiError(
      `Request failed: ${res.status} ${res.statusText}`,
      res.status,
      url,
    );
  }
  // For 204 No Content, return undefined as T (caller handles void)
  if (res.status === 204) return undefined as unknown as T;
  const raw = await res.json();
  const result = schema.safeParse(raw);
  if (!result.success) {
    console.error(
      `[api] Validation error for ${url}:`,
      result.error.issues,
      "Raw response:",
      raw,
    );
    throw new ApiError(
      `Response validation failed for ${url}`,
      res.status,
      url,
    );
  }
  return result.data as T;
}

/** Send a request that returns no body (or 204). Throws ApiError on non-ok status. */
async function fetchVoid(url: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new ApiError(
      `Request failed: ${res.status} ${res.statusText}`,
      res.status,
      url,
    );
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function fetchSessions(): Promise<Session[]> {
  return fetchJson("/_/api/sessions", SessionsSchema);
}

export async function fetchSession(id: string): Promise<Session> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(id)}`, SessionSchema);
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/messages`, MessagesSchema);
}

export async function fetchPlan(sessionId: string): Promise<Plan> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/plan`, PlanSchema);
}

export async function fetchDiffs(sessionId: string): Promise<DiffFile[]> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/diffs`, DiffsSchema);
}

export async function fetchEdits(sessionId: string): Promise<FileEdit[]> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/edits`, FileEditsSchema);
}

export async function setSessionName(sessionId: string, displayName: string): Promise<void> {
  await fetchVoid(`/_/api/sessions/${encodeURIComponent(sessionId)}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
}

export async function clearSessionName(sessionId: string): Promise<void> {
  await fetchVoid(`/_/api/sessions/${encodeURIComponent(sessionId)}/name`, {
    method: "DELETE",
  });
}

export async function fetchResumeCommand(sessionId: string): Promise<string> {
  const data = await fetchJson(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/resume`,
    ResumeCommandSchema,
  );
  return data.command;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function fetchSources(): Promise<Source[]> {
  return fetchJson("/_/api/sources", SourcesSchema);
}

export async function addSource(
  path: string,
  agentType: string,
  label?: string,
  enabled?: boolean,
): Promise<Source> {
  return fetchJson("/_/api/sources", SourceSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, agentType, label, enabled: enabled ?? true }),
  });
}

export async function removeSource(id: string): Promise<void> {
  await fetchVoid(`/_/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateSource(
  id: string,
  data: { path?: string; agentType?: string; label?: string; enabled?: boolean },
): Promise<void> {
  await fetchVoid(`/_/api/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function resetApp(): Promise<void> {
  await fetchVoid("/_/api/reset", { method: "POST" });
}

export async function fetchConfig(): Promise<Record<string, string>> {
  return fetchJson("/_/api/config", ConfigSchema);
}

export async function setConfig(key: string, value: string): Promise<void> {
  await fetchVoid("/_/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

// ---------------------------------------------------------------------------
// Search & Status
// ---------------------------------------------------------------------------

export async function fetchRecentSearches(): Promise<string[]> {
  return fetchJson("/_/api/recent-searches", z.array(z.string()));
}

export async function addRecentSearches(searches: string[]): Promise<void> {
  await fetchVoid("/_/api/recent-searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(searches),
  });
}

export async function fetchStatus(): Promise<StatusInfo> {
  return fetchJson("/_/api/status", StatusInfoSchema);
}

export async function fetchSearch(
  query: string,
  limit = 50,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (sessionId) params.set("session_id", sessionId);
  return fetchJson(`/_/api/search?${params}`, SearchResultsSchema, signal ? { signal } : undefined);
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function fetchFolders(): Promise<Folder[]> {
  return fetchJson("/_/api/folders", FoldersSchema);
}

export async function createFolder(name: string, color?: string, icon?: string): Promise<Folder> {
  return fetchJson("/_/api/folders", FolderSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color, icon }),
  });
}

export async function updateFolder(
  id: string,
  name: string,
  color?: string,
  icon?: string,
): Promise<void> {
  await fetchVoid(`/_/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color || "", icon: icon || "" }),
  });
}

export async function deleteFolder(id: string): Promise<void> {
  await fetchVoid(`/_/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchFolderSessions(folderId: string): Promise<string[]> {
  return fetchJson(`/_/api/folders/${encodeURIComponent(folderId)}/sessions`, FolderSessionsSchema);
}

export async function assignSessionToFolder(folderId: string, sessionId: string): Promise<void> {
  await fetchVoid(
    `/_/api/folders/${encodeURIComponent(folderId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "POST" },
  );
}

export async function unassignSessionFromFolder(
  folderId: string,
  sessionId: string,
): Promise<void> {
  await fetchVoid(
    `/_/api/folders/${encodeURIComponent(folderId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// Scratch Files
// ---------------------------------------------------------------------------

export async function fetchScratchFiles(sessionId: string): Promise<ScratchFile[]> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/scratch`, ScratchFilesSchema);
}

export async function createScratchFile(
  sessionId: string,
  title: string,
  content?: string,
  mode?: "writable" | "readonly",
): Promise<ScratchFile> {
  return fetchJson(`/_/api/sessions/${encodeURIComponent(sessionId)}/scratch`, ScratchFileSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content: content || "", mode: mode || "writable" }),
  });
}

export async function getScratchFile(sessionId: string, fileId: string): Promise<ScratchFile> {
  return fetchJson(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    ScratchFileSchema,
  );
}

export async function updateScratchFile(
  sessionId: string,
  fileId: string,
  title: string,
  content: string,
): Promise<void> {
  await fetchVoid(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    },
  );
}

export async function renameScratchFile(
  sessionId: string,
  fileId: string,
  newTitle: string,
): Promise<void> {
  await fetchVoid(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    },
  );
}

export async function deleteScratchFile(sessionId: string, fileId: string): Promise<void> {
  await fetchVoid(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
}

export async function fetchAllScratchFiles(): Promise<ScratchFile[]> {
  return fetchJson("/_/api/scratch", ScratchFilesSchema);
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export async function fetchBookmarks(): Promise<Bookmark[]> {
  return fetchJson("/_/api/bookmarks", BookmarksSchema);
}

export async function createBookmark(data: {
  sessionId: string;
  messageIndex: number;
  toolCallId?: string;
  label: string;
}): Promise<{ action: "created" | "deleted"; bookmark?: Bookmark; id?: string }> {
  return fetchJson("/_/api/bookmarks", BookmarkToggleSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteBookmark(id: string): Promise<void> {
  await fetchVoid(`/_/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
}
