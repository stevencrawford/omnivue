import { Effect, Schedule } from "effect";
import * as api from "../hooks/apiClient";
import type { Session, Message, Plan, DiffFile, FileEdit } from "../hooks/types";
import { ApiError, catchToApiError } from "./common";

export class SessionService extends Effect.Service<SessionService>()("SessionService", {
  effect: Effect.gen(function* () {
    const list = (): Effect.Effect<Session[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSessions(),
        catch: catchToApiError("/_/api/sessions"),
      }).pipe(Effect.retry(Schedule.recurs(3)));

    const getById = (id: string): Effect.Effect<Session, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSession(id),
        catch: catchToApiError(`/_/api/sessions/${id}`),
      });

    const getMessages = (id: string): Effect.Effect<Message[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchMessages(id),
        catch: catchToApiError(`/_/api/sessions/${id}/messages`),
      });

    const getPlan = (id: string): Effect.Effect<Plan, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchPlan(id),
        catch: catchToApiError(`/_/api/sessions/${id}/plan`),
      });

    const getDiffs = (id: string): Effect.Effect<DiffFile[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchDiffs(id),
        catch: catchToApiError(`/_/api/sessions/${id}/diffs`),
      });

    const getEdits = (id: string): Effect.Effect<FileEdit[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchEdits(id),
        catch: catchToApiError(`/_/api/sessions/${id}/edits`),
      });

    const getResumeCommand = (id: string): Effect.Effect<string, ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchResumeCommand(id),
        catch: catchToApiError(`/_/api/sessions/${id}/resume`),
      });

    const setName = (id: string, displayName: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.setSessionName(id, displayName),
        catch: catchToApiError(`/_/api/sessions/${id}/name`),
      });

    const clearName = (id: string): Effect.Effect<void, ApiError> =>
      Effect.tryPromise({
        try: () => api.clearSessionName(id),
        catch: catchToApiError(`/_/api/sessions/${id}/name`),
      });

    return {
      list,
      getById,
      getMessages,
      getPlan,
      getDiffs,
      getEdits,
      getResumeCommand,
      setName,
      clearName,
    } as const;
  }),
}) {}
