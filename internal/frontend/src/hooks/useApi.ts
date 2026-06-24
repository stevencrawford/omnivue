// API types and fetch functions for the sess frontend.

export interface Session {
  id: string;
  sourceId: string;
  parentId?: string;
  title: string;
  repository: string;
  branch: string;
  agent: string;
  subAgent?: string;
  model: string;
  cost: number;
  directory: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  messageCount: number;
  diffFiles: number;
  diffAdditions: number;
  diffDeletions: number;
}

export interface Source {
  id: string;
  path: string;
  agentType: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}

export interface StepEvent {
  step: "start" | "finish";
  snapshot?: string;
  reason?: string;
  cost?: number;
  tokens?: StepTokens;
}

export interface StepTokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  stepEvents?: StepEvent[];
  timestamp: string;
  model?: string;
  agent?: string;
  tokensInput?: number;
  tokensOutput?: number;
  metadata?: Record<string, string>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output: string;
  status: string;
  duration?: number;
  metadata?: string;
}

export interface ScratchFile {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatusInfo {
  version: string;
  pid: number;
  sources: number;
  sessions: number;
}

export interface Plan {
  markdown: string;
  source: string;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface FileEdit {
  filePath: string;
  toolName: string;
  oldStr?: string;
  newStr?: string;
  content?: string;
  viewRange?: [number, number];
  timestamp: string;
}

export interface SearchResult {
  sessionId: string;
  sessionName?: string;
  sourceId: string;
  chunkType: string;
  repository: string;
  snippet: string;
  updatedAt?: string;
  fileTitle?: string;
  fileId?: string;
  messageIndex?: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  sortOrder: number;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/_/api/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchSession(id: string): Promise<Session> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch session");
  return res.json();
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function fetchPlan(sessionId: string): Promise<Plan> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/plan`);
  if (!res.ok) throw new Error("Failed to fetch plan");
  return res.json();
}

export async function fetchDiffs(sessionId: string): Promise<DiffFile[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/diffs`);
  if (!res.ok) throw new Error("Failed to fetch diffs");
  return res.json();
}

export async function fetchEdits(sessionId: string): Promise<FileEdit[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/edits`);
  if (!res.ok) throw new Error("Failed to fetch edits");
  return res.json();
}

export async function setSessionName(sessionId: string, displayName: string): Promise<void> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error("Failed to set session name");
}

export async function clearSessionName(sessionId: string): Promise<void> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/name`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear session name");
}

export async function fetchResumeCommand(sessionId: string): Promise<string> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/resume`);
  if (!res.ok) throw new Error("Failed to fetch resume command");
  const data = await res.json();
  return data.command;
}

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch("/_/api/sources");
  if (!res.ok) throw new Error("Failed to fetch sources");
  return res.json();
}

export async function addSource(
  path: string,
  agentType: string,
  label?: string,
  enabled?: boolean,
): Promise<Source> {
  const res = await fetch("/_/api/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, agentType, label, enabled: enabled ?? true }),
  });
  if (!res.ok) throw new Error("Failed to add source");
  return res.json();
}

export async function removeSource(id: string): Promise<void> {
  const res = await fetch(`/_/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove source");
}

export async function updateSource(
  id: string,
  data: { path?: string; agentType?: string; label?: string; enabled?: boolean },
): Promise<void> {
  const res = await fetch(`/_/api/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update source");
}

export async function fetchConfig(): Promise<Record<string, string>> {
  const res = await fetch("/_/api/config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function setConfig(key: string, value: string): Promise<void> {
  const res = await fetch("/_/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error("Failed to set config");
}

export async function fetchStatus(): Promise<StatusInfo> {
  const res = await fetch("/_/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function fetchSearch(
  query: string,
  limit = 50,
  sessionId?: string,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (sessionId) params.set("session_id", sessionId);
  const res = await fetch(`/_/api/search?${params}`);
  if (!res.ok) throw new Error("Failed to search");
  return res.json();
}

export async function fetchFolders(): Promise<Folder[]> {
  const res = await fetch("/_/api/folders");
  if (!res.ok) throw new Error("Failed to fetch folders");
  return res.json();
}

export async function createFolder(name: string, color?: string, icon?: string): Promise<Folder> {
  const res = await fetch("/_/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color, icon }),
  });
  if (!res.ok) throw new Error("Failed to create folder");
  return res.json();
}

export async function updateFolder(
  id: string,
  name: string,
  color?: string,
  icon?: string,
): Promise<void> {
  const res = await fetch(`/_/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, color: color || "", icon: icon || "" }),
  });
  if (!res.ok) throw new Error("Failed to update folder");
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`/_/api/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete folder");
}

export async function fetchFolderSessions(folderId: string): Promise<string[]> {
  const res = await fetch(`/_/api/folders/${encodeURIComponent(folderId)}/sessions`);
  if (!res.ok) throw new Error("Failed to fetch folder sessions");
  return res.json();
}

export async function assignSessionToFolder(folderId: string, sessionId: string): Promise<void> {
  const res = await fetch(
    `/_/api/folders/${encodeURIComponent(folderId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error("Failed to assign session");
}

export async function unassignSessionFromFolder(
  folderId: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(
    `/_/api/folders/${encodeURIComponent(folderId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to unassign session");
}

// --- Scratch Files ---

export async function fetchScratchFiles(sessionId: string): Promise<ScratchFile[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/scratch`);
  if (!res.ok) throw new Error("Failed to fetch scratch files");
  return res.json();
}

export async function createScratchFile(
  sessionId: string,
  title: string,
  content?: string,
): Promise<ScratchFile> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/scratch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content: content || "" }),
  });
  if (!res.ok) throw new Error("Failed to create scratch file");
  return res.json();
}

export async function getScratchFile(sessionId: string, fileId: string): Promise<ScratchFile> {
  const res = await fetch(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
  );
  if (!res.ok) throw new Error("Failed to get scratch file");
  return res.json();
}

export async function updateScratchFile(
  sessionId: string,
  fileId: string,
  title: string,
  content: string,
): Promise<void> {
  const res = await fetch(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    },
  );
  if (!res.ok) throw new Error("Failed to update scratch file");
}

export async function renameScratchFile(
  sessionId: string,
  fileId: string,
  newTitle: string,
): Promise<void> {
  const getRes = await fetch(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
  );
  if (!getRes.ok) throw new Error("Failed to get scratch file");
  const file = await getRes.json();
  const res = await fetch(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, content: file.content }),
    },
  );
  if (!res.ok) throw new Error("Failed to rename scratch file");
}

export async function deleteScratchFile(sessionId: string, fileId: string): Promise<void> {
  const res = await fetch(
    `/_/api/sessions/${encodeURIComponent(sessionId)}/scratch/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete scratch file");
}

export async function fetchAllScratchFiles(): Promise<ScratchFile[]> {
  const res = await fetch("/_/api/scratch");
  if (!res.ok) throw new Error("Failed to fetch scratch files");
  return res.json();
}

// --- Bookmarks ---

export interface Bookmark {
  id: string;
  sessionId: string;
  messageIndex: number;
  toolCallId?: string;
  label: string;
  createdAt: string;
}

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const res = await fetch("/_/api/bookmarks");
  if (!res.ok) throw new Error("Failed to fetch bookmarks");
  return res.json();
}

export async function createBookmark(data: {
  sessionId: string;
  messageIndex: number;
  toolCallId?: string;
  label: string;
}): Promise<{ action: "created" | "deleted"; bookmark?: Bookmark; id?: string }> {
  const res = await fetch("/_/api/bookmarks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to toggle bookmark");
  return res.json();
}

export async function deleteBookmark(id: string): Promise<void> {
  const res = await fetch(`/_/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete bookmark");
}
