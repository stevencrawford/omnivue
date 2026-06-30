export const STORAGE_KEYS = {
  THEME: "omnivue-theme",
  MODE: "omnivue-mode",
  SHOW_COSTS: "omnivue-show-costs",
  SIDEBAR_WIDTH: "omnivue-sidebar-width",
  SIDEBAR_COLLAPSED: "omnivue-sidebar-collapsed",
  SIDEBAR_SORT: "omnivue-sidebar-sort",
  SIDEBAR_DISPLAY: "omnivue-sidebar-display",
  PINNED_HEIGHT: "omnivue-pinned-height",
  PROJECT_FOLDERS_EXPANDED: "omnivue-project-folders-expanded",
  PROJECT_FOLDER_SORT: "omnivue-project-folder-sort",
  DIFF_TREE_WIDTH: "omnivue-diff-tree-width",
  SEEN_SESSIONS: "omnivue-seen-sessions",
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
