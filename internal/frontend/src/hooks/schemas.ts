// Zod schemas for runtime validation of API responses.
// Every API response that returns data should be validated through these
// schemas to ensure the backend contract matches what the frontend expects.

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Primitives & helpers
// ---------------------------------------------------------------------------

const optionalString = z.string().optional();
const coerceNumber = z.coerce.number();

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const StepTokensSchema = z.object({
  input: coerceNumber,
  output: coerceNumber,
  reasoning: coerceNumber,
  cacheRead: coerceNumber,
  cacheWrite: coerceNumber,
});

const StepEventSchema = z.object({
  step: z.enum(["start", "finish"]),
  snapshot: optionalString,
  reason: optionalString,
  cost: coerceNumber.optional(),
  tokens: StepTokensSchema.optional(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.string(),
  output: z.string(),
  status: z.string(),
  duration: coerceNumber.optional(),
  metadata: z.string().optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  reasoning: optionalString,
  toolCalls: z.array(ToolCallSchema).optional(),
  stepEvents: z.array(StepEventSchema).optional(),
  timestamp: z.string(),
  model: optionalString,
  agent: optionalString,
  tokensInput: coerceNumber.optional(),
  tokensOutput: coerceNumber.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const SessionSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  parentId: optionalString,
  title: z.string(),
  repository: z.string(),
  branch: z.string(),
  agent: z.string(),
  subAgent: optionalString,
  model: z.string(),
  cost: coerceNumber,
  directory: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tokensInput: coerceNumber,
  tokensOutput: coerceNumber,
  tokensReasoning: coerceNumber,
  tokensCacheRead: coerceNumber,
  tokensCacheWrite: coerceNumber,
  messageCount: coerceNumber,
  diffFiles: coerceNumber,
  diffAdditions: coerceNumber,
  diffDeletions: coerceNumber,
});

export const SessionsSchema = z.array(SessionSchema);
export const MessagesSchema = z.array(MessageSchema);

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

export const SourceSchema = z.object({
  id: z.string(),
  path: z.string(),
  agentType: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
});

export const SourcesSchema = z.array(SourceSchema);

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PlanSchema = z.object({
  markdown: z.string(),
  source: z.string(),
});

// ---------------------------------------------------------------------------
// DiffFile
// ---------------------------------------------------------------------------

const DiffFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: coerceNumber,
  deletions: coerceNumber,
  patch: optionalString,
});

export const DiffsSchema = z.array(DiffFileSchema);

// ---------------------------------------------------------------------------
// FileEdit
// ---------------------------------------------------------------------------

const FileEditSchema = z.object({
  filePath: z.string(),
  toolName: z.string(),
  oldStr: optionalString,
  newStr: optionalString,
  content: optionalString,
  viewRange: z.tuple([coerceNumber, coerceNumber]).optional(),
  timestamp: z.string(),
});

export const FileEditsSchema = z.array(FileEditSchema);

// ---------------------------------------------------------------------------
// ScratchFile
// ---------------------------------------------------------------------------

export const ScratchFileSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  content: z.string(),
  mode: z.enum(["writable", "readonly"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ScratchFilesSchema = z.array(ScratchFileSchema);

// ---------------------------------------------------------------------------
// StatusInfo
// ---------------------------------------------------------------------------

export const StatusInfoSchema = z.object({
  version: z.string(),
  pid: coerceNumber,
  sources: coerceNumber,
  sessions: coerceNumber,
});

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------

const SearchResultSchema = z.object({
  sessionId: z.string(),
  sessionName: optionalString,
  sourceId: z.string(),
  chunkType: z.string(),
  repository: z.string(),
  snippet: z.string(),
  updatedAt: optionalString,
  fileTitle: optionalString,
  fileId: optionalString,
  messageIndex: coerceNumber.optional(),
});

export const SearchResultsSchema = z.array(SearchResultSchema);

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: optionalString,
  sortOrder: coerceNumber,
  color: optionalString,
  icon: optionalString,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const FoldersSchema = z.array(FolderSchema);
export const FolderSessionsSchema = z.array(z.string());

// ---------------------------------------------------------------------------
// Bookmark
// ---------------------------------------------------------------------------

export const BookmarkSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  messageIndex: coerceNumber,
  toolCallId: optionalString,
  label: z.string(),
  createdAt: z.string(),
});

export const BookmarksSchema = z.array(BookmarkSchema);

// Toggle bookmark response
export const BookmarkToggleSchema = z.object({
  action: z.enum(["created", "deleted"]),
  bookmark: BookmarkSchema.optional(),
  id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ConfigSchema = z.record(z.string(), z.string());

// ---------------------------------------------------------------------------
// Resume command
// ---------------------------------------------------------------------------

export const ResumeCommandSchema = z.object({
  command: z.string(),
});
