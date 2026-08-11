let counter = 0;

/**
 * Return a collision-resistant, crypto-backed id, falling back to a
 * timestamp + counter + random suffix when `crypto.randomUUID` is
 * unavailable (insecure context).
 */
export function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}
