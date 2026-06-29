export function extractJSONField(jsonStr: string, field: string): string | null {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed === null || typeof parsed !== "object") return null;
    const val = (parsed as Record<string, unknown>)[field];
    if (typeof val === "string" && val) return val;
    if (typeof val === "number") return String(val);
    return null;
  } catch {
    return null;
  }
}
