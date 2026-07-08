import { Effect, Layer, ManagedRuntime } from "effect";
import { SessionService } from "../services/session";
import { NotificationService } from "../services/notification";
import { SearchService } from "../services/search";
import { SourceService } from "../services/source";
import { ConfigService } from "../services/config";
import { StatusService } from "../services/status";
import { FolderService } from "../services/folder";
import { ScratchService } from "../services/scratch";
import { BookmarkService } from "../services/bookmark";
import { RecentSearchService } from "../services/recentSearch";

const MainLayer = Layer.mergeAll(
  SessionService.Default,
  NotificationService.Default,
  SearchService.Default,
  SourceService.Default,
  ConfigService.Default,
  StatusService.Default,
  FolderService.Default,
  ScratchService.Default,
  BookmarkService.Default,
  RecentSearchService.Default,
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
