// API types and fetch functions for the sess frontend.

export interface Session {
  id: string;
  sourceId: string;
  title: string;
  repository: string;
  branch: string;
  agent: string;
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

export interface Message {
  id: string;
  role: string;
  content: string;
  toolCalls?: ToolCall[];
  timestamp: string;
  model?: string;
  agent?: string;
  tokensInput?: number;
  tokensOutput?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output: string;
  status: string;
  duration?: number;
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

export interface SearchResult {
  sessionId: string;
  sourceId: string;
  chunkType: string;
  repository: string;
  snippet: string;
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

export async function fetchStatus(): Promise<StatusInfo> {
  const res = await fetch("/_/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
}

export async function fetchSearch(query: string, limit = 50): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
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

export async function updateFolder(id: string, name: string, color?: string, icon?: string): Promise<void> {
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
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Failed to assign session");
}

export async function unassignSessionFromFolder(folderId: string, sessionId: string): Promise<void> {
  const res = await fetch(
    `/_/api/folders/${encodeURIComponent(folderId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to unassign session");
}
