import { ApiError } from "../hooks/apiClient";

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export function describeApiError(err: unknown, fallback = "Request failed"): string {
  if (err instanceof ApiError) {
    return `${err.endpoint} failed: ${err.message}`;
  }
  if (isAbortError(err)) return "Request cancelled";
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * Run a promise-producing effect, routing failures through `onError`.
 * Returns the resolved value, or `undefined` when the effect rejects.
 * Hooks use this to centralize the repetitive try/catch-and-log blocks
 * that previously wrapped every data fetch.
 */
export async function runCatching<T>(
  effect: () => Promise<T>,
  onError?: (err: unknown) => void,
): Promise<T | undefined> {
  try {
    return await effect();
  } catch (err) {
    onError?.(err);
    return undefined;
  }
}
