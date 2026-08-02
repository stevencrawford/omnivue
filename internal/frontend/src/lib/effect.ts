import { Effect } from "effect";

export function runFork<A, E, R>(effect: Effect.Effect<A, E, R>): () => void {
  return Effect.runCallback(effect as Effect.Effect<A, E>);
}

export { Effect };
