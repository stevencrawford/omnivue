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

export interface PlanItem {
  content: string;
  status: string;
  priority: string;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
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

export async function fetchPlan(sessionId: string): Promise<PlanItem[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/plan`);
  if (!res.ok) throw new Error("Failed to fetch plan");
  return res.json();
}

export async function fetchDiffs(sessionId: string): Promise<DiffFile[]> {
  const res = await fetch(`/_/api/sessions/${encodeURIComponent(sessionId)}/diffs`);
  if (!res.ok) throw new Error("Failed to fetch diffs");
  return res.json();
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
