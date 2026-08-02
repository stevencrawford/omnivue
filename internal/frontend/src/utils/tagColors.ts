export const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
];

export const TAG_DEFAULT_COLOR = "#8b949e";
export const TAG_NO_COLOR = "";

export function hasTagColor(color?: string): boolean {
  return !!color && color.trim().length > 0;
}

export function tagColor(color?: string): string {
  return hasTagColor(color) ? color! : TAG_DEFAULT_COLOR;
}
