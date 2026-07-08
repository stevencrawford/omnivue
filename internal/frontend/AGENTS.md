# Omnivue Frontend — Conventions & Architecture

This file documents conventions, patterns, and best practices for the
TypeScript/React SPA at `internal/frontend/`. The broader project guide
lives at the repo root `AGENTS.md` (Go backend, build, API endpoints).

## Quick Reference

```bash
pnpm dev          # Vite dev server (proxies /_/ to Go backend at localhost:6275)
pnpm build        # tsc + vite build, outputs to ../static/dist
pnpm test         # vitest (jsdom)
pnpm fmt          # oxfmt — format all src/ files
pnpm lint         # oxlint
pnpm fmt:check    # check formatting without writing
```

## Directory Layout

```
src/
├── App.tsx                    # Root orchestrator — all data hooks, UI state, layout
├── main.tsx                   # Entry point; imports EffectJS runtime
├── lib/
│   └── effect.ts              # EffectJS ManagedRuntime, runPromise/runFork exports
├── services/                  # EffectJS service layer (wraps apiClient)
│   ├── index.ts               # Barrel re-export
│   ├── common.ts              # ApiError class
│   ├── session.ts             # SessionService — sessions, messages, plans, diffs, edits
│   ├── notification.ts        # NotificationService — list, markRead, clearAll, settings
│   ├── search.ts              # SearchService — full-text search
│   └── __tests__/
├── hooks/                     # Custom React hooks (state + data fetching)
│   ├── useSessions.ts         # Session list, SSE-driven updates
│   ├── useNotifications.ts    # Notification list, optimistic read/unread
│   ├── useSSE.ts              # Effect Stream-based SSE connection
│   ├── useSearchState.ts      # Search drawer with Effect fiber cancellation
│   ├── useBookmarks.ts        # Bookmark CRUD
│   ├── useScratchFiles.ts     # Scratch file management
│   ├── apiClient.ts           # Raw fetch functions + Zod validation (all endpoints)
│   ├── schemas.ts             # Zod schemas for every API response
│   ├── types.ts               # Domain types (Session, Message, ToolCall, etc.)
│   └── useApi.ts              # Barrel re-export of apiClient + types (backward compat)
├── components/
│   ├── AppHeader.tsx           # Top bar (logo, search, theme toggle)
│   ├── Sidebar.tsx             # Resizable sidebar with section panels
│   ├── SessionViewer.tsx       # Tabbed session detail (session/diff/plan/scratch/terminal)
│   ├── ConversationView.tsx    # Message list with grouping, scroll markers
│   ├── ...                     # ~40 more component files
│   └── ToolRenderers/         # Plugin-based tool call rendering
│       ├── AGENTS.md           # Dedicated renderer plugin docs
│       ├── registry.ts         # Auto-discovery via import.meta.glob
│       ├── builtin/            # 18 built-in tool renderers
│       └── vendor/             # Third-party renderers (auto-discovered)
├── utils/                     # Pure utility functions
│   ├── buildTree.ts            # Session → repo-grouped tree
│   ├── sessionFilters.ts       # Filter/sort logic
│   └── toolDisplay.ts          # Tool call display helpers
├── styles/
│   └── app.css                # Tailwind CSS v4 + custom theme
└── lib/
    └── browserNotify.ts       # OS notification + quiet-hours resolution
```

## State Management Patterns

### Data flow (one-way)

```
Server API → apiClient.ts (Zod validation) → useEffect/useCallback → useState → Props → Components
                            ↕ (Effect wrappers)
                     services/* (Effect.Service)
```

### Rules

- **State lives in hooks**, not in component state. Components receive data and callbacks via props.
- `App.tsx` calls all data hooks at the top level (`useSessions`, `useNotifications`, etc.) and passes data down.
- **Cross-cutting concerns use Context**: `ThemeProvider`, `ToastProvider`, `SessionNavContext`, `SearchHighlightContext`. Never prop-drill more than 2 levels.
- **Local UI state** (modal visibility, active tab, scroll position) stays as `useState`/`useRef` in the component. Do not put trivial UI state in Effect or Context.
- **Immutable updates only**: `setState(prev => prev.map(...))`, spread, filter. No mutations.

### Hook contract

Every data hook returns `{ data, loading, error?, actionHandlers... }`:

```typescript
// Pattern
export function useSessions(): SessionsState {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { ... }, []);
  useEffect(() => { load(); }, [load]);
  return { sessions, sessionsLoading: loading, loadSessions: load, ... };
}
```

## EffectJS Service Layer

Added during the EffectJS migration (refactor/effectjs-migration). Used for
SSE stream management, composable API calls with typed errors, and fiber-based
cancellation.

### Runtime

```typescript
// lib/effect.ts
const runtime = ManagedRuntime.make(Layer.mergeAll(
  SessionService.Default,
  NotificationService.Default,
  SearchService.Default,
));

// Use these at the React boundary:
runPromise(effect)    // → Promise<A>  (for useCallback/useEffect)
runFork(effect)      // → () => void   (cancel function, for fiber management)
```

### Service definition pattern

```typescript
// services/session.ts
export class SessionService extends Effect.Service<SessionService>()("SessionService", {
  effect: Effect.gen(function*() {
    const list = (): Effect.Effect<Session[], ApiError> =>
      Effect.tryPromise({
        try: () => api.fetchSessions(),
        catch: (e) => new ApiError(String(e), e instanceof Response ? e.status : 0, "/_/api/sessions"),
      }).pipe(Effect.retry(Schedule.recurs(3)));

    const getMessages = (id: string): Effect.Effect<Message[], ApiError> => ...

    return { list, getMessages, ... } as const;
  }),
}) {}
```

### Accessing services from React

```typescript
// In a hook or component:
import { Effect } from "effect";
import { runPromise, runFork } from "../lib/effect";
import { SessionService } from "../services";

// One-shot call (e.g., on mount)
runPromise(
  SessionService.pipe(
    Effect.flatMap(svc => svc.list()),
    Effect.catchAll(err => { console.error(err.message); return Effect.succeed([]); }),
  ),
).then(setSessions);

// With fiber cancellation (e.g., for search, message loading)
const cancel = runFork(
  SessionService.pipe(
    Effect.flatMap(svc => svc.getMessages(sessionId)),
    Effect.map(setMessages),
    Effect.catchAll(err => Effect.sync(() => setMessages([]))),
    Effect.ensuring(Effect.sync(() => setLoading(false))),
  ),
);
cancelRef.current = cancel; // call cancel() to interrupt
```

### When to use Effect vs raw apiClient

| Scenario | Use |
|----------|-----|
| Simple one-shot fetch with no retry | `apiClient.fetchXxx()` (direct) |
| Fetch that needs retry, cancellation, or composition | Effect service |
| SSE event streams | `useSSE.ts` (Effect Stream) |
| Search with debounce and abort | Effect service + fiber cancel |
| Optimistic updates (notifications) | Effect service for API call, local React state for optimistic render |

## API Client

- **Every** API response is validated at runtime via Zod schemas in `schemas.ts`.
- Raw fetch functions live in `apiClient.ts`. Effect service wrappers live in `services/*.ts`.
- Barrel file `useApi.ts` re-exports everything for backward compatibility.
- Prefer importing directly from `./apiClient` or `./types` in new code, not from the barrel.

```typescript
// apiClient.ts — all functions are typed promises with Zod validation
export async function fetchSessions(): Promise<Session[]> {
  return fetchJson("/_/api/sessions", SessionsSchema);
}
```

## Component Conventions

### Structure
- One component per file, PascalCase filename.
- Props interface named `{ComponentName}Props`, defined above the function.
- Default export discouraged — use named exports.

### Event handler naming
- `handleXxx` for event handlers (e.g., `handleSearchSelect`, `handleDrawerClose`).
- `onXxx` for prop callbacks (e.g., `onTabChange`, `onSessionSelect`).

### Tab panels
- All tabs remain mounted, inactive ones hidden via `className="hidden"`.
- Lazy-loaded flags (`diffLoaded`, `planLoaded`) set on first tab click to avoid
  unnecessary API calls. These are simple `useState<boolean>`, not Effect.

## Tool Renderer Plugin System

See `src/components/ToolRenderers/AGENTS.md` for full details.

Key rules:
- Plugin discovery via Vite `import.meta.glob` — no manual registration needed.
- Every renderer must handle both `variant="summary"` and `variant="detail"`.
- Output truncation is system-level in `ToolRendererWrapper`. Renderers must not truncate.
- For color/display conventions, see the dedicated AGENTS.md.

## TypeScript

```
strict: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true
```

- `verbatimModuleSyntax` requires `import type` for type-only imports.
- `erasableSyntaxOnly` forbids enums, namespaces, and parameter properties.
- No path aliases — all imports are relative.
- No `any` except in extreme cases (prefer `unknown` + narrowing).

## Testing

- **Test runner**: Vitest with jsdom environment.
- **Test location**: co-located `__tests__/` directories next to source.
- **Test pattern**: `describe` / `it` / `expect` from vitest.
- **Component tests**: React Testing Library.
- **Service tests**: Mock `apiClient.ts` functions with `vi.mock`, test Effect
  pipelines via `runPromise(ServiceTag.pipe(...))`.
- Effect's `TestClock` is available for time-dependent stream tests.

```typescript
// Example service test pattern
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import * as api from "../../hooks/apiClient";
import { runPromise } from "../../lib/effect";
import { SessionService } from "../session";

vi.mock("../../hooks/apiClient", () => ({ fetchSessions: vi.fn() }));

it("returns sessions on success", async () => {
  vi.mocked(api.fetchSessions).mockResolvedValue([mockSession]);
  const result = await runPromise(
    SessionService.pipe(Effect.flatMap(svc => svc.list())),
  );
  expect(result).toHaveLength(1);
});
```

## Formatting & Linting

- `oxfmt` for formatting (config at `.oxfmtrc.json`)
- `oxlint` for linting (config at `.oxlintrc.json`)
- `oxlint` will warn about generator functions without `yield` — this is expected
  for `Effect.Service` definitions and can be ignored.
- Always run `pnpm fmt` after making changes to any `src/` file.
