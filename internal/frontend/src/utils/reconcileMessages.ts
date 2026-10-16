import type { Message } from "../hooks/types";

/**
 * Reconcile a fresh message list against the previously rendered one so that
 * unchanged messages keep their object identity. Memoized message rendering
 * relies on this, so preserving identity prevents needless re-renders (and
 * markdown re-parsing) on every SSE poll. Returns `prev` unchanged when nothing
 * differs.
 */
export function reconcileMessages(prev: Message[], next: Message[]): Message[] {
  if (prev.length === 0 || next.length === 0 || prev.length !== next.length) {
    return next;
  }
  const prevById = new Map(prev.map((m) => [m.id, m]));
  let same = true;
  const merged = next.map((m) => {
    const old = prevById.get(m.id);
    if (old && messagesEqual(old, m)) return old;
    same = false;
    return m;
  });
  return same ? prev : merged;
}

function messagesEqual(a: Message, b: Message): boolean {
  if (
    a.id !== b.id ||
    a.role !== b.role ||
    a.content !== b.content ||
    a.reasoning !== b.reasoning ||
    a.error !== b.error ||
    a.model !== b.model
  ) {
    return false;
  }
  if (JSON.stringify(a.metadata ?? null) !== JSON.stringify(b.metadata ?? null)) {
    return false;
  }
  const ta = a.toolCalls ?? [];
  const tb = b.toolCalls ?? [];
  if (ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) {
    const x = ta[i];
    const y = tb[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.status !== y.status ||
      x.input !== y.input ||
      x.output !== y.output ||
      x.duration !== y.duration ||
      JSON.stringify(x.metadata ?? null) !== JSON.stringify(y.metadata ?? null)
    ) {
      return false;
    }
  }
  return true;
}
