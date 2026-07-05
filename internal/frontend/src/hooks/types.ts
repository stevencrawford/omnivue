// Domain types for the Omnivue frontend.
// These represent the wire format from the backend API.

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
  todos?: Todo[];
}

export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: string; // "pending", "in_progress", "done", "blocked"
  depends_on?: string[];
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
  error?: string;
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
  mode: "writable" | "readonly";
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

export interface Bookmark {
  id: string;
  sessionId: string;
  messageIndex: number;
  toolCallId?: string;
  label: string;
  createdAt: string;
}

export type NotificationKind =
  | "question"
  | "task_complete"
  | "new_messages"
  | "new_tool_call"
  | "status_active"
  | "status_completed"
  | "status_error";

export type NotificationSeverity = "info" | "attention";

export interface NotificationPayload {
  toolCallId?: string;
  messageId?: string;
  messageIndex?: number;
  toolName?: string;
  count?: number;
  tabHint?: string;
  [key: string]: unknown;
}

export interface AppNotification {
  id: string;
  sessionId: string;
  sourceId: string;
  kind: NotificationKind;
  title: string;
  preview: string;
  severity: NotificationSeverity;
  payload?: string; // JSON string of NotificationPayload
  createdAt: number; // unix ms
  readAt?: number | null; // unix ms, undefined/null = unread
}

export type NotificationScope = "all" | "opened" | "pinned";

export interface NotificationSettings {
  enabled: boolean;
  kinds: NotificationKind[];
  scope: NotificationScope;
  inAppToast: boolean;
  sidebarBadge: boolean;
  browserNotify: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  autoDismissSec: number;
  excludeActiveView: boolean;
  enabledAt?: number;
}
