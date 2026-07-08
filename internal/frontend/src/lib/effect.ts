import { Effect, Layer, ManagedRuntime } from "effect";
import { SessionService } from "../services/session";
import { NotificationService } from "../services/notification";
import { SearchService } from "../services/search";

const MainLayer = Layer.mergeAll(
  SessionService.Default,
  NotificationService.Default,
  SearchService.Default,
);

const runtime = ManagedRuntime.make(MainLayer);

export function runPromise<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: { signal?: AbortSignal },
): Promise<A> {
  return runtime.runPromise(effect as Effect.Effect<A, E>, options);
}

export function runFork<A, E, R>(effect: Effect.Effect<A, E, R>): () => void {
  return runtime.runCallback(effect as Effect.Effect<A, E>);
}

export { Effect };
