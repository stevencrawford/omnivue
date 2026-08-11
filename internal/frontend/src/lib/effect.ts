import { Effect } from "effect";

export function runFork<A, E>(effect: Effect.Effect<A, E>): () => void {
  return Effect.runCallback(effect);
}

export { Effect };
