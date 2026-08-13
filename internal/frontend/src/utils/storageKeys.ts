export const STORAGE_KEYS = {
  THEME: "omnivue-theme",
  MODE: "omnivue-mode",
  CONTRAST: "omnivue-contrast",
  HIDE_COSTS: "omnivue-hide-costs",
  SIDEBAR_WIDTH: "omnivue-sidebar-width",
  SIDEBAR_COLLAPSED: "omnivue-sidebar-collapsed",
  SIDEBAR_GROUP: "omnivue-sidebar-group",
  SIDEBAR_DISPLAY: "omnivue-sidebar-display",
  PINNED_HEIGHT: "omnivue-pinned-height",
  DIFF_TREE_WIDTH: "omnivue-diff-tree-width",
  DIFF_TREE_COLLAPSED: "omnivue-diff-tree-collapsed",
  TAGS_EXPANDED: "omnivue-tags-expanded",
  TAG_SORT: "omnivue-tag-sort",
  COPY_MODE_PREFIX: "omnivue-copy-mode-",
  SESSION_POSITION_PREFIX: "omnivue-session-position-",
  DISABLE_CUSTOM_RENDERERS: "omnivue-disable-custom-renderers",
  OVERVIEW_TIME_RANGE: "omnivue-overview-timerange",
} as const;

export function getStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

export function getStorageJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setStorageJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* noop */
  }
}
