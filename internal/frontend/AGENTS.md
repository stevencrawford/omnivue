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
├── main.tsx                   # Entry point
├── lib/
│   └── effect.ts              # EffectJS runFork helper (SSE stream execution only)
├── hooks/                     # Custom React hooks (state + data fetching)
│   ├── useSessions.ts         # Session list, SSE-driven updates
│   ├── useNotifications.ts    # Notification list, optimistic read/unread
│   ├── useSSE.ts              # Effect Stream-based SSE connection
│   ├── useSearchState.ts      # Search drawer with AbortController cancellation
│   ├── useBookmarks.ts        # Bookmark CRUD
│   ├── useScratchFiles.ts     # Scratch file management
│   ├── apiClient.ts           # Raw fetch functions + Zod validation + ApiError
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
Server API → apiClient.ts (Zod validation + ApiError) → useEffect/useCallback → useState → Props → Components
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

## EffectJS — SSE only

Effect is used **only** for the SSE event stream in `useSSE.ts` (streams, exponential-backoff retry, cancellation). Everything else goes through `apiClient.ts` directly.

```typescript
// lib/effect.ts — the only Effect export at the React boundary
runFork(effect)   // → () => void  (cancel function; used by useSSE.ts)
```

Cancellation for one-shot fetches uses `AbortController` (e.g. `useSearchState`, `SessionViewer`) — see `apiClient.ts` functions that accept a `signal`.

## API Client

- **Every** API response is validated at runtime via Zod schemas in `schemas.ts`.
- Raw fetch functions live in `apiClient.ts`; `ApiError extends Error` is defined and exported there (the single app-wide error type).
- `fetchSessions()` is the only endpoint with retry (folded into `apiClient`).
- Barrel file `useApi.ts` re-exports everything for backward compatibility.
- Prefer importing directly from `./apiClient` or `./types` in new code, not from the barrel.

```typescript
// apiClient.ts — all functions are typed promises with Zod validation
export async function fetchSessions(): Promise<Session[]> {
  return withRetry(() => fetchJson("/_/api/sessions", SessionsSchema), 3);
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
- **Service tests**: Mock `apiClient.ts` functions with `vi.mock`, or stub global `fetch` to test the apiClient boundary directly.

```typescript
// Example apiClient boundary test (src/hooks/__tests__/apiClient.test.ts)
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchSessions, ApiError } from "../apiClient";

const fetchMock = vi.fn();

describe("fetchSessions", () => {
  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it("retries on failure and eventually succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(jsonResponse([mockSession]));
    const result = await fetchSessions();
    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

## Formatting & Linting

- `oxfmt` for formatting (config at `.oxfmtrc.json`)
- `oxlint` for linting (config at `.oxlintrc.json`)
- Always run `pnpm fmt` after making changes to any `src/` file.
