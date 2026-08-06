// Domain types for the Omnivue frontend.
// Derived from the Zod schemas in schemas.ts so every wire field is declared
// exactly once (schemas.ts is the single source of truth for the API contract).
// Types with no runtime validation are declared by hand below.

import type { z } from "zod/v4";
import type {
  BookmarkSchema,
  DiffFileSchema,
  DiscoveredSourceSchema,
  FileEditSchema,
  MessageSchema,
  NotificationKindSchema,
  NotificationScopeSchema,
  NotificationSchema,
  NotificationSettingsSchema,
  NotificationSeveritySchema,
  PlanSchema,
  QueuedPromptSchema,
  SearchResultSchema,
  ScratchFileSchema,
  SessionSchema,
  SourceSchema,
  StatusInfoSchema,
  StepEventSchema,
  StepTokensSchema,
  TagSchema,
  TodoSchema,
  ToolCallSchema,
} from "./schemas";

export type Session = z.infer<typeof SessionSchema>;
export type Todo = z.infer<typeof TodoSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type DiscoveredSource = z.infer<typeof DiscoveredSourceSchema>;
export type StepEvent = z.infer<typeof StepEventSchema>;
export type StepTokens = z.infer<typeof StepTokensSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ScratchFile = z.infer<typeof ScratchFileSchema>;
export type StatusInfo = z.infer<typeof StatusInfoSchema>;
export type Plan = NonNullable<z.infer<typeof PlanSchema>>;
export type DiffFile = z.infer<typeof DiffFileSchema>;
export type FileEdit = z.infer<typeof FileEditSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Bookmark = z.infer<typeof BookmarkSchema>;
export type BookmarkKind = "message" | "plan";
export type NotificationKind = z.infer<typeof NotificationKindSchema>;
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;
export type NotificationScope = z.infer<typeof NotificationScopeSchema>;
export type AppNotification = z.infer<typeof NotificationSchema>;
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
export type QueuedPrompt = z.infer<typeof QueuedPromptSchema>;

// Decoding target for AppNotification.payload (an opaque JSON string stored in
// the wire format). Not runtime-validated, so it stays a hand-written shape.
export interface NotificationPayload {
  toolCallId?: string;
  messageId?: string;
  messageIndex?: number;
  toolName?: string;
  count?: number;
  tabHint?: string;
  [key: string]: unknown;
}
