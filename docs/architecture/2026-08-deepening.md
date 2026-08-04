# Architecture Deepening Spec — 2026

Status: **Active** — Lead: architecture lead
Last updated: 2026-08-04

This spec consolidates the codebase architecture review into a single ranked list of
**deepening opportunities** — refactors that turn shallow modules into deep ones. It is the
single source of truth that agents claim work slices from. Each task has a stable `ATH-*`
id and its own Goals / Files / Seam / Acceptance / Tests card.

> **Vocabulary** (from the `codebase-design` skill, used consistently): **module**,
> **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**,
> **locality**. Never substitute "component / service / API / boundary".

---

## How to work from this spec

1. Read the [Execution order](#execution-order) and [claim table](#claim-table).
2. **Claim** the next `open` task in the current wave by setting its row in the claim table
   to `claimed (your name)`.
3. Two agents must not claim two tasks in the same wave that share a seam (the Execution
   order marks these).
4. Build against the card's **Files** and **Seam**. Meet **Acceptance**, run the **Done**
   gates, then flip the row to `done`.
5. Keep this doc updated as you go — it is the coordination surface between agents.

### Done gates

- **Backend cards:** from `AGENTS.md` — `go build ./...`, `golangci-lint run ./...`,
  `gostyle`, `go test ./...`, `make test` all pass.
- **Frontend cards:** `cd internal/frontend && pnpm run fmt`; frontend tests/lint/build pass.
- For the risky waves: `make test` before calling a card done.

---

## Claim table

| # | Task | Rank | Wave | Status |
|----|------|------|------|--------|
| ATH-01 | Split the `State` god-object | H | 0 | done |
| ATH-02 | Split `store.Store` into role interfaces | H | 0 | done |
| ATH-03 | De-leak & normalize the HTTP handler layer | H | 0 | done |
| ATH-04 | Collapse EffectJS service layer / unify `ApiError` | H | 1 | done |
| ATH-05 | Centralize ingest tool-call canonicalization | H | 2 | done |
| ATH-06 | Shrink the `ingest` Adapter interface + fix doc drift | H | 2 | done |
| ATH-07 | Single tool-kind + token-color taxonomy | H | 2 | open |
| ATH-08 | Focus context / shrink App prop surface | M | 3 | done |
| ATH-09 | Split the god components | M | 3 | in progress (named components done; ConversationView/SessionViewer/SearchPanel remain) |
| ATH-10 | Frontend shared widgets & constants (dedup) | M | 2 | in progress (STORAGE_KEYS/FilterChip/useHideCosts done; literals + resize + section-group remain) |
| ATH-11 | Hook-contract consistency | M | 3 | done |
| ATH-12 | Effect-cleanup correctness | M | 1 | done |
| ATH-13 | Error / loading / empty-state consistency | M | 1 | done |
| ATH-14 | Adapter derived-parse for `edits` | M | 3 | done |
| ATH-15 | Derive frontend types from Zod / retire barrel | L | 4 | open |
| ATH-16 | Dead & duplicate helper cleanup | L | 4 | open (mostly done via ATH-09; minor leftovers) |
| ATH-17 | `useSessionRouting` hash-effect conflict | L | 4 | open |

---

## Execution order

- **Wave 0 — server-in, lock the seams:** ATH-01 → ATH-02 → ATH-03. These compose:
  ATH-02's role interfaces are what ATH-03 injects into handlers. Do in this order.
- **Wave 1 — cheap correctness (frontend):** ATH-12, ATH-13, ATH-04. Low risk,
  de-risks everything downstream. ATH-13 and ATH-04 both touch `ApiError` — do ATH-04 first
  so there is one error type to standardize on.
- **Wave 2 — dedup extraction:** ATH-10, ATH-05, ATH-07, ATH-06. All pure extraction, no
  seam decisions. ATH-07 depends on constants that live partly in ATH-10 — do ATH-10 before
  ATH-07.
- **Wave 3 — deliberate Context refactor:** ATH-08, ATH-11, ATH-09, ATH-14. The risky ones;
  do ATH-08/ATH-11 together and deliberately.
- **Wave 4 — low priority:** ATH-15, ATH-16, ATH-17.

**Top recommendation:** start with **ATH-01** (split `state`) with ATH-02 as the paired
seam. It delivers the largest leverage + locality payoff and makes the HTTP interface
testable without the poll machinery.

---

# Task cards

## ATH-01 — Split the `state` god-object

- **Files:** `internal/server/server.go` (`State`, ~1100 lines of methods)
- **Problem:** One struct under one `mu` carries the entire application tier: polling,
  FTS indexing, notification classification, SSE pub/sub, and every domain query. A new
  feature means a new method on the same seam; one mutex is the whole render of state.
- **Goals:**
  - `SessionHub` — cached sessions + adapters, query, mutation
  - `Poller` — `pollLoop`, adaptive scheduling
  - `Indexer` — `indexSessions`, `reindexSessionScratch`
  - `Notifier` — `classifyChanges`, `advanceSeenCursors`; pub/sub (`subscribe`/`unsubscribe`/
    `sendEvent`) lives on the separate `EventBus` (`internal/server/events.go`) — a tighter seam
    than pinning pub/sub onto the Notifier.
- **Seam:** each collaborator exposes a narrow interface; callers depend on the slice they
  need, never the whole type. In practice the collaborators are concrete types with narrow
  method sets (the store side gets true Go interfaces via ATH-02); the seam is the method set,
  not a Go interface.
- **Acceptance / Done:** `server_test.go` composes small fixtures instead of hand-rolling a
  15-field struct; a test drives the poll → index → classify → SSE path through the Poller /
  Notifier rather than a live HTTP spin-up; existing tests pass unchanged in behaviour.
- **Tests:** add a poll-path integration test; keep each existing behaviour test green.
- **Recommendation:** Strong.

---

## ATH-02 — Split `store.Store` into narrow role interfaces

- **Files:** `internal/store/store.go`, `internal/server/server.go`
- **Problem:** One concrete `*store.Store` (~57 methods across sources, tags, groups,
  scratch, notifications, prompts, FTS) is bound into every handler and poll path. A
  tags-UI change drags in the whole surface, and tests must choose between real SQLite
  and `nil`.
- **Goals:** Split the one implementation across role interfaces — `SourceStore`,
  `TagStore`, `ScratchStore`, `SearchStore`, `NotificationStore`, `ConfigStore`,
  `PromptStore`, `SessionNameStore`, `BookmarkStore`. (`GroupStore` appeared in the
  original draft but never existed upstream: folders were replaced by tags in migration
  `0006`, and tags own that role.) Inject only the family each consumer needs.
- **Seam:** two adapters justify it: real SQLite in prod, a fake in tests. Keep the concrete
  type as the single impl; hands the pieces consumers only know the role.
- **Acceptance / Done:** handlers reference only the interfaces; `state.store` no longer
  appears in server handlers (goes through role params). A fake `---Store` used in
  `server_test.go` works.
- **Recommendation:** Strong.

---

## ATH-03 — De-leak & normalize the HTTP handler layer

- **Files:** `internal/server/server.go` (`NewHandler` + handlers, ~1400 lines)
- **Problem:** ~800–900 lines are parse → delegate → marshal scaffolding: 50+ identical
  encode-error tails, ~20 nil-guards, ~24 handlers reach into `state.store` directly, and
  `handleTerminalWS` re-derives the resume command that `ResumeCommand` already knows.
- **Goals:** a generic JSON decode + error-map + encode wrapper; handlers depend only on the
  narrow roles they serve (from ATH-02); fold terminal command lookup back onto
  `ResumeCommand`. The error-map is `apiError` (`badRequest`/`notFound`/`internalError`) with
  `errorStatus`, so handlers never pick a status literal.
- **Acceptance / Done:** the `failed to encode` tail is no longer copy-pasted; no handler
  touches `state.store` directly. A test helper wraps JSON round-trips + status propagation;
  handlers test against fake repositories.
- **Recommendation:** Strong.

---

## ATH-04 — Collapse the EffectJS service layer / unify `ApiError`

- **Files:** `internal/frontend/src/services/*`, `hooks/apiClient.ts`, `services/common.ts`,
  `lib/effect.ts`
- **Problem:** every `services/*.ts` is a literal `Effect.tryPromise(api.X)` pass-through
  that adds no behavior; `ApiError` is defined twice (one private in `apiClient`, one
  non-`Error` in `services/common.ts`), so calls re-map an error across a false seam.
- **Goals:** pick a side — fold retry + the one exported `ApiError` into `apiClient` and
  delete the shells, or keep Effect only where it earns (cancellation, streams, SSE).
- **Acceptance / Done:** exactly one exported `ApiError` app-wide; no fetch-shell `services`
  files remain; a test asserts retry/error behavior at the fetch boundary once, not twice.
- **Recommendation:** Strong.

---

## ATH-05 — Centralize ingest tool-call canonicalization

- **Files:** `internal/ingest/{cursor,pi,claude-code,codex}/{normalize,content}.go`,
  `internal/ingest/ingestkit/util.go`
- **Problem:** four adapters hand-copy the same canonical tool-name switch and the
  `invoke input → filePath` + `newString/oldString` + `pattern → query` rename idiom;
  `CanonicalToolNames()` exists but no adapter calls it; scanner buffer sizes are redefined.
- **Goals:** a table-driven `normalizeToolCall(tc)` in `ingestkit` owning the alias map and
  field transforms, consumed by all four adapters; use `ingestkit.NewJSONLScanner`.
- **Acceptance / Done:** one canonical-name declaration; editing an alias in one place
  changes all adapters. Table-driven tests cover every previously hand-written alias; four
  adapter test suites pass.
- **Recommendation:** Strong.

---

## ATH-06 — Shrink the `ingest` Adapter interface + fix doc drift

- **Files:** `internal/ingest/adapter.go`, `registry.go`, `detect.go`,
  `internal/ingest/AGENTS.md`
- **Problem:** `SessionSource` = 9 methods, `Adapter` = 12. Two are dead in production:
  `Detect` (only referenced in tests; production uses the registry's `Detector` closures)
  and `Type` (no production caller). Docs drift: `internal/ingest/AGENTS.md` documents
  `GetSession`/`GetMessages` while the code is unprefixed.
- **Goals:** strip `Detect`/`Type` from the interface, keeping the concrete helpers internal
  or on the registry detector; keep the optional `Planner`/`Differ`/`Editor` segregation;
  reconcile `AGENTS.md`.
- **Acceptance / Done:** no production call of `Detect` or `Type`; `internal/ingest/AGENTS.md`
  matches `adapter.go`; all six adapters compile.
- **Recommendation:** Strong on dead-method removal.

---

## ATH-07 — Single tool-kind + token-color taxonomy

- **Files:** `internal/frontend/src/ToolRenderers/registry.ts`,
  `hooks/useSessionSummary.ts`, `hooks/useSessionTokenomics.ts`,
  `components/OverviewScreen.tsx`, `components/ActivityCharts.tsx`
- **Problem:** kind → color/label/priority is rebuilt in ~3 places (the registry already
  emits it) and token input/output/cache/reasoning colors are triplicated.
- **Goals:** one derived `toolKindTaxonomy` (kind → color/label/priority) and one
  `tokenColorSegments`, consumed by the registry, the analytics hooks, and the overview.
- **Acceptance / Done:** no consumer re-declares a tool-kind color/label map; a color change
  is a single edit.
- **Recommendation:** Strong.

---

## ATH-08 — Focus context / shrink the App prop surface

- **Files:** `internal/frontend/src/App.tsx`, `SessionViewer.tsx`, `ConversationView.tsx`,
  `hooks/useNav.ts`
- **Problem:** the same `payload.messageIndex / messageId` parse-and-reset is hand-rolled in
  `handleSessionSelect`, `handleNotificationClick`, `handleBookmarkSelect`; ~25 props
  thread 4 levels to one leaf.
- **Goals:** a `Focus` context (jump to message + mark read + clear highlight) behind one
  seam; shrink `App`'s prop surface.
- **Acceptance / Done:** fewer than 3 places hand-parse the jump payload; leaf consumers
  read what they need via context.
- **Recommendation:** Worth exploring.

---

## ATH-09 — Split the god components

- **Files:** `SettingsModal.tsx` (~882), `SessionSummary.tsx` (~648), `ProjectPanel.tsx`
  (~481), `SessionPanel.tsx` (~371), `OverviewScreen.tsx` (~549), `DiffView.tsx`,
  `TagPanel.tsx`
- **Problem:** each owns 5–6 unrelated responsibilities (SettingsModal: 6 tabs + its own
  FilterChip + delete-confirm + factory reset + duplicated `randomUUID`).
- **Goals:** split per tab / per concern so each component has a single responsibility and
  stays readable.
- **Acceptance / Done:** none of the named components exceeds ~400 lines; each extracted
  concern is its own module under 400 lines.
- **Recommendation:** Worth exploring (high touch; payoff on the next edits).

---

## ATH-10 — Frontend shared widgets & constants (dedup)

- **Files:** (assembled from code-review/frontend scan): `StorageKeys.ts`,
  `Sidebar.tsx`, `DiffView.tsx`, `PinnedPromptBar.tsx` (localStorage + resize),
  `NotificationPanel.tsx`, `SessionPanel.tsx`, `SettingsModal.tsx` (FilterChip),
  `SearchPanel.tsx`, `SearchResultsDrawer.tsx` (section grouping).
- **Problem:** duplicated literals (`omnivue-*` keys despite `StorageKeys.ts`), the resize
  drag pattern ×3, `FilterChip`-style dropdown ×3, byte-for-byte search section-grouping
  ×2, `hideCosts()` reimplemented ×4, diff status colors repeated.
- **Goals:** `useResizable()` hook (cleanup included); one `FilterChip`/`SelectMenu`; a
  shared section-group util; one `useHideCosts()`; all keys via `STORAGE_KEYS`; diff status
  colors from a constant.
- **Acceptance / Done:** `rg "omnivue-"` returns only the `STORAGE_KEYS` constant; the
  section-grouping logic lives in one util.
- **Recommendation:** Strong; it also unlocks ATH-07.

---

## ATH-11 — Hook-contract consistency

- **Files:** `hooks/useSessions`, `useNotifications`, `useBookmarks`, `useSearchState`,
  `useAppKeyboard`, `tools/theme.ts`
- **Problem:** naming drift (`sessionsLoading` vs `loading`); some hooks leak raw `useState`
  setters (e.g. `setDrawerResults`); a near-identical `Service.pipe(…catchAll → succeed[])`
  + `*Effect()` wrapper is repeated ~5×; `useTheme` exposes aliases and two hand-synced
  arrays.
- **Goals:** one return-shape convention; expose action handlers only; extract one
  `runCatching(effect, onError)` helper; collapse `useTheme` to one alias + one
  `{value,label}` array.
- **Acceptance / Done:** the named hooks share a single return-shape contract; no raw
  setters in any hook return.
- **Recommendation:** Worth exploring.

---

## ATH-12 — Effect-cleanup correctness

- **Files:** `hooks/useNotifications.ts` (reloadTimer never cleared), `useSearchState.ts`
  (fiber/abort not cancelled), `useSearchHighlight.ts` (timers + DOM writes),
  `useRecentSearches.ts`
- **Problem:** timers/fibers/aborts not cleaned on unmount; `useRecentSearches` performs API
  writes inside a `setState` updater (impure, doubled under StrictMode).
- **Goals:** cleanup on unmount for every timer/fiber/abort; move the reducer side-effect out
  of the updater.
- **Acceptance / Done:** StrictMode produces no duplicate writes; no timer leaks after
  unmount.
- **Recommendation:** High — this one bites in dev.

---

## ATH-13 — Error / loading / empty-state consistency

- **Files:** `hooks/apiClient.ts`, `services/common.ts`, `DiffView.tsx`, `PlanView.tsx`,
  `SearchView.tsx`, scratch calls
- **Problem:** `catch {}` (ignore) vs `console.error` vs surfaced errors with no shared
  handler; hand-rolled Spinner/Loading/EmptyState markup ~6×; an `EmptyState.tsx` exists but
  is bypassed.
- **Goals:** one `ApiError` type (done in ATH-04 first), one error-toast helper, shared
  `Spinner` / `LoadingState` / `EmptyState`.
- **Recommendation:** Strong.

---

## ATH-14 — Adapter derived-parse for `edits`

- **Files:** `internal/ingest/{copilot,claude-code,codex}/edits.go`,
  `internal/server/server.go`
- **Problem:** each adapter's `getEdits` is a second full pass re-scanning raw data that
  `Messages`/`Plan`/`Diffs` already built; `Edits` re-parses what was `Message`-normalized.
- **Goals:** share the extraction, not the parse — e.g. `ExtractEdits(messages []Message)`
  in `ingest`, so each raw slice is scanned once.
- **Acceptance / Done:** a fresh-pull session serves its edits without opening the file
  twice.
- **Recommendation:** Worth one (formats differ; share the extraction).

---

## ATH-15 — Derive frontend types from Zod / retire the barrel

- **Files:** `hooks/types.ts`, `hooks/schemas.ts`, `hooks/useApi.ts`
- **Problem:** `types.ts` and `schemas.ts` repeat every field by hand with drifting
  optional/coerce; `useApi.ts`  is a third import path (the barrel).
- **Goals:** `export type X = z.infer<typeof XSchema>`; remove the barrel.
- **Acceptance / Done:** a field declared once; one import path.
- **Recommendation:** Low.

---

## ATH-16 — Dead & duplicate helper cleanup

- **Files:** `SessionSummary.tsx` (`formatSmallPct` ≈ `formatPct`), `ConversationView.tsx`
  (`dup SystemReminder`), `DiffView.tsx` (`computeFileStatus` never returns `deleted`),
  `OverviewScreen.tsx` (`agentLabel` duplicate of `sessionUtils`), `CopyButton` reimpl,
  `useAppKeyboard` missing deps, `lib/effect.ts` type assertions, `useNav` cohesion.
- **Goals:** delete or route duplicates through the shared helper.
- **Recommendation:** Low.

---

## ATH-17 — `useSessionRouting` hash-effect conflict

- **Files:** `hooks/useSessionRouting.ts`
- **Problem:** the hash-writing effect and hash-reading listener can fight (commented in
  code); review the round-trip hash logic.
- **Recommendation:** Low.

---

## Changelog / coordination

Append one line here each time a card flips to `done` so agents can see progress without
re-reading the whole table.

- 2026-08-04 — ATH-12 (effect-cleanup) done on `refactor/ath12-effect-cleanup`: `reloadTimer` cleared on unmount in `useNotifications`; `addRecentSearches` moved out of the `setSearches` updater in `useRecentSearches` (impure / StrictMode double-write); regression tests added. `make test` green.
- 2026-08-04 — ATH-08 (focus context) and ATH-11 (hook-contract consistency) done, merged on `dev` via #100 (`refactor/ath08-focus-ath11-hooks`): new `hooks/useFocus.tsx` (FocusContext + `parseMessageTarget`); `handleSessionSelect`/`handleBookmarkSelect`/`handleDiffNavigateToMessage`/`handleNotificationClick` consolidated onto `jumpToMessage`; `focus*`/`onClearFocus` props removed from leaf (reads `useFocus()`). Shared `runCatching(effect, onError)` in `utils/errors.ts`; `sessionsLoading` → `loading`; `useTheme` collapsed to `themeMode`/`THEME_OPTIONS`. Leaked raw setters intentionally kept (cross-hook coordination via `useAppKeyboard`/`useSessionRouting`). Frontend gates green.
- 2026-08-04 — ATH-13 (error/loading/empty-state) done, merged on `dev` via #96 (`refactor/ath13-error-loading`): shared `utils/errors.ts` (`getErrorMessage`/`isAbortError`/`describeApiError`), `showErrorToast` on the Toast context, shared `Spinner`/`LoadingState`/`EmptyPanel`; migrated the card's named files + `useSearchState`. Remaining ~90 catch sites left as incremental follow-up. `make test` green.
- 2026-08-04 — ATH-09 (split god components) part 1 merged on `dev` via #101 (`refactor/ath09-god-components`): SettingsModal 928→85 shell composing per-tab modules; extracted shared `FilterChip`, `useHideCosts`, `utils/uuid.ts` `makeId`; SessionPanel 758→391, TagPanel 677→354, DiffView 677→321, SessionSummary 648→99, OverviewScreen 434→208; `ProjectPanel` removed. Remaining god-files still >400 lines: ConversationView (498), SessionViewer (500), SearchPanel (418).
- 2026-08-04 — ATH-12 (effect-cleanup) done, merged on `dev` via #95 (`refactor/ath12-effect-cleanup`): `reloadTimer` cleared on unmount in `useNotifications`; `addRecentSearches` moved out of the `setSearches` updater in `useRecentSearches` (impure / StrictMode double-write); regression tests added. `make test` green.
- 2026-08-04 — ATH-14 (adapter derived-parse for `edits`) done, merged on `dev` via #99 (`refactor/ath14-edits-derive`).
- 2026-08-04 — ATH-05 (ingest tool-call canonicalization) & ATH-06 (shrink Adapter interface + doc drift) done, merged on `dev` via #89 (`refactor/ingest-architecture`): `ingestkit.CanonicalizeToolName` alias table consumed by all adapters; `Detect`/`Type` stripped from the interface; `internal/ingest/AGENTS.md` reconciled.
- 2026-08-04 — ATH-01/02/03 (State split, store role interfaces, HTTP handler de-leak) done, merged on `dev` via #88 (`refactor/state-store-split`). ATH-04 (EffectJS collapse / unified `ApiError`) via #87 (`refactor/ath04-collapse-effect-services`).
- 2026-08-02 — PR review response round 3 on `refactor/state-store-split`: S1 liveness heuristic dedup (`applyLiveness`), S2 fan-out bundle (`fanout` struct, handlers + Poller share it), S3 scratch read routed through `requireStore`, S4 `util.go` dissolved into single-consumer homes, Spec(a) 200 centralized behind `writeOK` (48 sites). Kept + responded: Spec(b) frontend heartbeat (half of A2, card-tied), Spec(c) test rewrite + hub-private `SessionNameStore` (accepted D3 consequence), S5 `State` facade (reviewer called acceptable). `make test` green.
- 2026-08-02 — PR review response round 2 on `refactor/state-store-split`: A1 typed-nil store roles (`storeRoles`/`storeRolesOf`, never box a nil `*Store`), A2 `ExcludeActiveView` wired end-to-end (+ frontend heartbeat), A3 indexer hash-dedup restored (`updateIndexState`), B1/B2 `prevStatus`+`SetNames` deleted, C1/C2 fan-out+scratch-chunk dedup (`fanoutSessions`, `indexScratchChunk`), D1/D2/D3 handler seams narrowed + status writes centralized (`writeNoContent`/`writeCreated`/`writeAccepted`/`requireStore`) + in-memory fake stores for handler tests. Resolve-changes kept and pinned by `server_test.go`; `make test` green.
- 2026-08-02 — ATH-04 (EffectJS service layer collapse + unified `ApiError`) done on `refactor/ath04-collapse-effect-services`.
- 2026-08-02 — ATH-03 (HTTP handler de-leak + JSON helpers) done on `refactor/state-store-split`.
- 2026-08-02 — ATH-01 (State god-object split) and ATH-02 (store role interfaces) done on `refactor/state-store-split`.
- 2026-08-02 — PR review response on `refactor/state-store-split`: ATH-03 error-map (`apiError` + `errorStatus`), real-store poll→index→classify→SSE test, `Resolve` fallback enrichment, gofmt churn reverted, spec cards annotated.
- 2026-08-02 — Spec created; all tasks `open`.