import { getStorageJSON, setStorageJSON, STORAGE_KEYS } from "./storageKeys";

/** Kinds of items the activity drawer can show. */
export type ActivityItemKind = "user" | "assistant" | "thinking" | "tool";

/** Include list: a kind is rendered only while its flag is true. */
export type ActivityFilters = Record<ActivityItemKind, boolean>;

export const ACTIVITY_KINDS: readonly ActivityItemKind[] = [
  "user",
  "assistant",
  "thinking",
  "tool",
];

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  user: true,
  assistant: true,
  thinking: true,
  tool: true,
};

function storedFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Read the persisted visibility flags. Missing, partial, or malformed values
 * fall back to visible so a corrupt preference never blanks the panel.
 */
export function loadActivityFilters(): ActivityFilters {
  const stored = getStorageJSON<Record<string, unknown>>(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS);
  if (!stored) return DEFAULT_ACTIVITY_FILTERS;
  return {
    user: storedFlag(stored.user, DEFAULT_ACTIVITY_FILTERS.user),
    assistant: storedFlag(stored.assistant, DEFAULT_ACTIVITY_FILTERS.assistant),
    thinking: storedFlag(stored.thinking, DEFAULT_ACTIVITY_FILTERS.thinking),
    tool: storedFlag(stored.tool, DEFAULT_ACTIVITY_FILTERS.tool),
  };
}

export function saveActivityFilters(filters: ActivityFilters): void {
  setStorageJSON(STORAGE_KEYS.CINEMATIC_ACTIVITY_FILTERS, filters);
}

export function isActivityKindVisible(kind: ActivityItemKind, filters: ActivityFilters): boolean {
  return filters[kind];
}
