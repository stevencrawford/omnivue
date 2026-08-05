# Architecture Deepening Spec — 2026, Round 2

Status: **Active** — Lead: architecture lead
Last updated: 2026-08-04

Round 2 of the codebase architecture review. Round 1 (ATH-01..17) is fully shipped in
`2026-08-deepening.md`. This spec tracks the deepening opportunities surfaced by the
2026-08-04 architecture review (refresh pipeline, ingest adapter seam, resume-command
module, tool-kind vocabulary, diff pipeline, data-loading lifecycle, search module).

It follows the same shape as Round 1: each task has a stable `ATH-*` id and its own
Goals / Files / Seam / Acceptance / Tests card.

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

---

## Claim table

| # | Task | Rank | Wave | Status |
|----|------|------|------|--------|
| ATH-18 | One refresh pipeline (kill the poller's split-brain) | H | 0 | done |
| ATH-19 | Collapse the ingest `Adapter`'s vestigial optionality | H | 1 | done |
| ATH-20 | Resume-command module (domain stops importing the PTY) | M | 1 | done |
| ATH-21 | Single tool-kind vocabulary (notify + indexer) | M | 2 | done |
| ATH-22 | Deepen the diff pipeline (no parse→serialize→parse) | H | 2 | done |
| ATH-23 | One data-loading lifecycle behind one interface | H | 3 | open |
| ATH-24 | A search module (stop scattering search across 7 files) | H | 3 | open |

---

## Execution order

- **Wave 0 — the app's live-update core:** ATH-18. Fold the poll → index → classify → SSE
  path into one module; unblocks the test rewrite.
- **Wave 1 — backend seam cleanup:** ATH-19, ATH-20. Both touch the ingest/server seam but
  not the same files; ATH-19 reopens ATH-06's "keep the optional segregation" decision
  (the optionality is fictional).
- **Wave 2 — backend vocabulary + frontend pure pipeline:** ATH-21, ATH-22. ATH-22 is
  frontend-pure and independent; ATH-21 is a small backend vocab module.
- **Wave 3 — frontend state lifecycles:** ATH-23, ATH-24. Both rework the hooks layer;
  do ATH-23 first since it establishes the load lifecycle ATH-24's search module can reuse.

**Top recommendation:** start with **ATH-18** (one refresh pipeline). It is the app's
live-update core, it is exactly where the ATH-01 split left split-brain friction, and
deepening it into a single module makes the poll→index→classify→SSE path testable through
one interface instead of six collaborators plus a real database and deadline polling.

---

# Task cards

## ATH-18 — One refresh pipeline: kill the poller's split-brain

- **Files:** `internal/server/poller.go` (`tick`), `internal/server/state.go` (`fanout`,
  `fanoutSessions`), `internal/server/hub.go` (`refreshSessions`), `internal/server/notifier.go`,
  `internal/server/indexer.go`, `internal/server/server_test.go` (integration test at ~491-578)
- **Problem:** the refresh → index → classify → broadcast path has two implementations.
  `poller.go:97-111` (the idle-cadence branch) hand-rolls `bus.Send` + `notif.ClassifyChanges`
  that `fanoutSessions` (state.go:193) already owns, so the two cadences can drift. The
  full-path test (server_test.go:491-578) must compose six collaborators against a real
  SQLite store and deadline-poll goroutines — poor locality.
- **Goals:** one `Pipeline` module owning refresh + index + classify + broadcast; `tick` and
  the HTTP add/update/remove-source handlers are thin callers of the same interface; the
  idle branch calls it instead of re-implementing it.
- **Seam:** the pipeline's interface is two methods — `Refresh(ctx) (liveCount int)` (full
  pass) and `RefreshLiveness(ctx) (liveCount int)` (light pass); internals (hub, indexer,
  notifier, bus) sit behind it. Both poll cadences and the source handlers cross the same
  seam. Synchronous; callers own concurrency.
- **Acceptance / Done:** the idle branch no longer mentions `bus.Send`/`ClassifyChanges`
  directly; the integration test drives the pipeline through one module rather than
  hand-wiring `hub`+`index`+`notif`+`poller`+`bus`; existing behaviour tests pass unchanged.
- **Tests:** add a poll-path integration test against the pipeline module; keep each
  existing behaviour test green.
- **Recommendation:** Strong.

### Plan (locked 2026-08-04)

Decisions: **synchronous pipeline** (caller owns goroutines) · **two methods** (`Refresh`
+ `RefreshLiveness`) · name **`Pipeline`** (term recorded in `CONTEXT.md`) · route
`handleRemoveSource` through it now.

- Rename `fanout` → `Pipeline` (state.go:169-179). Still bundles `hub`/`indexer`/`notif`/
  `bus`; all refresh→broadcast orchestration lives behind it. Add `Pipeline` to `Dep`
  (state.go:17-37) so `NewHandler` (server.go:35-37) reuses the poller's instance instead
  of constructing ad-hoc fanouts from `Dep` fields.
- `Pipeline.Refresh(ctx) (liveCount int)` — full pass: `hub.refreshSessions` → `update` +
  `session-changed` broadcasts → `IndexSessions` → `ClassifyChanges`, all synchronous.
  Broadcasts run immediately after the refresh so clients can discover the fresh hub cache
  without waiting on the heavier index pass (the 2026-08-05 follow-up; the original plan had
  broadcast last). Replaces `refreshAndIndex` + `fanoutSessions` (state.go:184-206).
- `Pipeline.RefreshLiveness(ctx) (liveCount int)` — refresh + light broadcast: `update` +
  `ClassifyChanges` only when `liveCount` changed. Absorbs poller.go:97-111; the idle branch
  stops touching `bus`/`notif` directly.
- `Poller.tick` (poller.go:72-111): changed → `p.liveCount = p.pipeline.Refresh(ctx)`;
  idle+live → `p.liveCount = p.pipeline.RefreshLiveness(ctx)`. Poller no longer calls
  `hub.refreshSessions`, `bus.Send`, or `ClassifyChanges`.
- Handlers + initial load route through it: `handleAddSource` (server.go:193),
  `handleUpdateSource` (247), `handleRemoveSource` (server.go:198-209 — replace the direct
  `hub.refreshSessions` + `bus.Send` with `go pipeline.Refresh`, keeping `hub.RemoveAdapter`
  + store removal inline), and `NewState`'s initial load (state.go:112).
- Rewrite the integration test (server_test.go:491-578) to drive `Pipeline` directly and
  synchronously — no deadline polling; add a `RefreshLiveness` determinism test (broadcasts
  only on liveCount change).

**Concurrency note:** `Poller.Run` already runs in its own goroutine, and the three handlers
+ initial load all wrap the call in `go`. `Refresh`/`RefreshLiveness` are synchronous AND take
a `sync.Mutex` over the whole pass, so index passes are serialized (no overlap) even when the
poller tick and a handler refresh land simultaneously — the guarantee is code-backed, not
conventional (pinned by `TestPipeline_SerializesConcurrentRefreshPasses`).

**Behavior change to note:** `handleRemoveSource`'s refresh moves from synchronous (before
`writeNoContent`) to backgrounded `go pipeline.Refresh(...)` — the frontend learns of the
removal via the SSE pulse instead of the DELETE response implying a fresh cache. Consistent
with how add/update already behave.

---

## ATH-19 — Collapse the ingest `Adapter`'s vestigial optionality

- **Files:** `internal/ingest/adapter.go`, `internal/ingest/types.go` (`SessionDetail`),
  `internal/server/hub.go:190,202,214`
- **Problem:** the forced union (`Adapter` = 10 mandatory methods) makes the
  `adapter.(Planner/Differ/Editor)` assertions always-true and forces cursor to carry a
  stub `Plan`; `SessionDetail` (types.go:246) is dead. Interface is nearly as wide as the
  implementation.
- **Goals:** require only the methods every adapter really implements; make plan/diffs/edits
  either empty-returning or a genuinely-optional capability seam; delete dead types.
- **Seam:** capabilities that truly differ get a real seam; the rest is a flat, honest
  interface.
- **Acceptance / Done:** no always-true type assertion remains; no adapter carries a stub
  method for a capability it lacks; all six adapters compile; `SessionDetail` deleted.
- **Tests:** table-driven test asserting each adapter's declared capabilities match its
  actual behaviour.
- **Recommendation:** Worth exploring.

> ⚠️ **Reopens ATH-06** — which recorded "keep the optional `Planner`/`Differ`/`Editor`
> segregation." Worth it because the optionality is fictional: the forced union guarantees
> the assertions always succeed, so the segregation never actually isolates anything.

---

## ATH-20 — Resume-command module: stop the domain importing a PTY

- **Files:** `internal/server/hub.go:221-233`, `internal/terminal/terminal.go:139-147`
  (`ExtractCmd`), six adapter `adapter.go` files (`ResumeCommand`/`AgentCommand`)
- **Problem:** `hub.go:12` imports `internal/terminal` (a PTY/process-spawning package) just
  to call `ExtractCmd`, a pure string split; the `cd %s && <bin> <flag> <id>` template is
  re-declared 6× and the `/resume %s` AgentCommand 5× (only opencode differs); `AgentCommand`
  has zero tests. The `ResumeSpec` field naming (`Absolute`/`Relative`) is misleading —
  "Relative" is really "command with the `cd` prefix stripped".
- **Goals:** adapters return structured command parts; a pure resume-command module owns the
  template + relative derivation; the terminal module only runs the result.
- **Seam:** the resume-command module is pure (no I/O, no PTY); adapters and the hub depend
  on it; `terminal` consumes its output at the edge.
- **Acceptance / Done:** `hub.go` no longer imports `internal/terminal`; one template
  declaration; `AgentCommand` is unit-tested; `ResumeSpec` renamed to say what it is.
- **Tests:** table-driven tests over the resume-command module; an `AgentCommand` test per
  adapter.
- **Recommendation:** Worth exploring.

---

## ATH-21 — Single tool-kind vocabulary (notify + indexer)

- **Files:** `internal/notify/notify.go:111-131` (`QuestionToolNames`/`PermissionToolNames`/
  `TaskCompleteToolNames`), `internal/server/indexer.go:48-56` (`isPlanTool`)
- **Problem:** which tool-call name means "question"/"permission"/"plan" is maintained in
  two modules with independently-maintained literals, so a classification edit fixes only
  one reader.
- **Goals:** one small vocabulary module next to `ingestkit.CanonicalizeToolName` that maps a
  tool name → kind; notify and indexer both consume it.
- **Seam:** the vocabulary module is pure and lives beside the existing canonicalization;
  notify (pure) and indexer (server tier) are both callers.
- **Acceptance / Done:** no tool-name literal appears in both notify and indexer; a name
  added to the vocabulary is classified everywhere on the next build.
- **Tests:** a table test over the vocabulary covering the union of both modules' current
  literals.
- **Recommendation:** Worth exploring.

---

## ATH-22 — Deepen the diff pipeline: stop the parse→serialize→parse round-trip

- **Files:** `internal/frontend/src/utils/diff.ts`, `utils/diffTree.ts:109-121`,
  `components/DiffRenderer.tsx:77-143` (`PatchRenderer`), `components/EditToolDiff.tsx:104`,
  `components/DiffView.tsx`
- **Problem:** `computeDiff` returns structured `DiffHunk` objects, but `mergeFileEdits`
  (diffTree.ts:109-121) throws the structure away and serializes to unified-diff text, which
  `PatchRenderer` (DiffRenderer.tsx:81-139) re-parses line-by-line (`@@` headers, `+`/`-`
  prefixes, line-number counters); `DiffView` re-scans the text a third time for search
  matching; `EditToolDiff` is a second consumer of the same text. The pure diff logic is the
  most regression-prone code in the app and has zero tests.
- **Goals:** the renderer consumes the structured hunk objects directly; text serialization
  is a single leaf function used only at the copy/export edge.
- **Seam:** one deep diff module owns compute → merge → render; `DiffView` and
  `EditToolDiff` are thin callers; text exists only where it leaves the module.
- **Acceptance / Done:** no component re-parses unified-diff text for rendering; the search
  match runs over structured hunks; `diff.ts`/`diffTree.ts` have tests.
- **Tests:** unit tests over compute/merge/render using structured hunks.
- **Recommendation:** Strong.

---

## ATH-23 — One data-loading lifecycle behind one interface

- **Files:** `internal/frontend/src/components/{PlanView,DiffView,SearchPanel,TagPanel,
  ScratchEditor,SessionViewer,SessionTabBar,SessionHeader,ResumeButton,QueuePanel,
  PinnedPromptBar,ManageTagsDialog,AgentSettingsTab,…}`, `hooks/apiClient.ts`
- **Problem:** the load → loading → error pattern is hand-rolled in ~16 components
  (`useState(loading) → useEffect(load) → try/catch(showErrorToast)`) against the repo's own
  "state lives in hooks" rule; search alone has three `fetchSearch` call sites with three
  cancellation/limit semantics; retry is a one-off on `fetchSessions`.
- **Goals:** a deep `useLoadResource`-shaped module owning abort, loading, error, and retry;
  components declare only their fetcher.
- **Seam:** the module's interface is `{ data, loading, error, reload }`; components cross it
  with a single fetcher argument. Tests cross one seam, not sixteen copies.
- **Acceptance / Done:** no component hand-rolls the load lifecycle; retry is a policy, not a
  one-off; the named components render from the module's state.
- **Tests:** unit tests for the lifecycle module (abort, error, reload, retry); a
  smoke test per migrated component.
- **Recommendation:** Strong.

---

## ATH-24 — A search module: stop scattering one feature across seven files

- **Files:** `components/SearchPanel.tsx`, `components/SearchResultsDrawer.tsx`, `hooks/
  useSearchState.ts`, `hooks/useSearchScope.ts`, `hooks/useRecentSearches.ts`, `hooks/
  useAppKeyboard.ts`, `hooks/useSearchHighlight.ts`, `App.tsx`
- **Problem:** one feature spread across seven modules with three keyboard stacks
  (SearchPanel, SearchResultsDrawer, useAppKeyboard), three `fetchSearch` call sites, dead
  code (`useSearchScope.scopedSearch`/`clearScope`), and two hooks both exported as
  `useSearchHighlight`.
- **Goals:** one search module owning query/scope/results/selection/navigation; the panel
  and drawer are thin renderers over it; one keyboard handler; dead code deleted.
- **Seam:** the module's interface is the search state + action handlers; both renderers and
  the keyboard handler are callers.
- **Acceptance / Done:** no component re-implements arrow-key navigation; one `fetchSearch`
  call site; `useSearchScope` deleted; the `useSearchHighlight` collision resolved.
- **Tests:** unit tests for the search module (query, scope, results, navigation); component
  smoke tests for panel and drawer.
- **Recommendation:** Strong.

---

## Changelog / coordination

Append one line here each time a card flips to `done` so agents can see progress without
re-reading the whole table.

- 2026-08-04 — Spec created from the 2026-08-04 architecture review (report
  `architecture-review-1785877277.html`). All tasks `open`.
- 2026-08-04 — ATH-18 plan locked: synchronous `Pipeline` (`Refresh` + `RefreshLiveness`),
  remove-source routed through it, term recorded in `CONTEXT.md`. Card updated.
- 2026-08-04 — ATH-18 done. `fanout` renamed to `Pipeline` in `state.go`; single synchronous
  refresh→index→classify→broadcast path with caller-owned `go`; `RefreshLiveness` drops the
  poller's idle/live split-brain (caller-supplied previous live count); Poller + `handleAddSource`/
  `handleRemoveSource`/`handleUpdateSource` route through it on the shared `Dep.Pipeline`
  instance; remove-source refresh now async like add/update. Integration test rewritten to drive
  the pipeline synchronously (no deadline polling) + new `RefreshLiveness` determinism test.
  Backend gates green (`go build`, `golangci-lint`, `gostyle`, `go test`, `make test`).
- 2026-08-05 — ATH-18 follow-up: `Pipeline.Refresh` now broadcasts `update` + `session-changed`
  immediately after `refreshSessions` instead of after the full `IndexSessions` pass. The locked
  plan had broadcast last; in practice the synchronous index pass gated session discovery on a
  15s re-index over a large store, so startup felt slow. Broadcast-first keeps the single
  synchronous pipeline (index passes still serialized) while serving the hub cache to clients
  right away. Verified: first SSE `update` at ~2s vs ~17s before, search still fully indexed.
- 2026-08-05 — ATH-18 review follow-up: the "no overlap" concurrency guarantee is now code-backed.
  `Pipeline` gained a `sync.Mutex` taken over the whole `Refresh`/`RefreshLiveness` pass, so the
  poller goroutine and the handlers' `go p.Refresh(...)` calls can no longer interleave index
  passes. New `TestPipeline_SerializesConcurrentRefreshPasses` drives 8 concurrent refreshes
  against a tracking fake search store and fails on any overlapping index write (verified to fail
  at 8 concurrent writes with the lock removed). Locked-plan text updated to broadcast-first.
- 2026-08-05 — Wave 1 done (ATH-19 + ATH-20). **ATH-19:** `Adapter` is now the core
  `SessionSource` only; `Planner`/`Differ`/`Editor` are genuinely-optional capability seams. Cursor
  and Pi's stub `Plan`s deleted (both had one), dead `SessionDetail` removed, hub's type assertions
  (hub.go:190,202,214) are now meaningful. New `TestAdapterCapabilities` table pins all six
  adapters' declared capabilities. **ATH-20:** new pure `internal/resumecmd` module owns the
  `cd %s && <bin> <flag> <id>` template (`Spec{Binary,Flag,Sep,Verb}` → `Command`/`CommandNoCD`/
  `AgentCommand`); `SessionSource.ResumeCommand()` returns the structured `resumecmd.Spec`; hub
  renders the `ResumeSpec` and no longer imports `internal/terminal`; `terminal.ExtractCmd`
  deleted; `ResumeSpec.Absolute/Relative` renamed `Command`/`CommandNoCD` (JSON wire keys
  unchanged); the empty-directory → `.` fallback lives in `resumecmd.Spec.Command` and the
  `ResumeSpec.Directory` field stays the raw session directory. Per-adapter resume +
  `AgentCommand` tests added for all six (opencode/copilot gained tests). Backend gates green
  (`go build`, `golangci-lint`, `gostyle`, `go test`, `make test`); `resumecmd` at 100% coverage.
- 2026-08-05 — Wave 2 done (ATH-21 + ATH-22). **ATH-21:** new pure `ingestkit.ToolKind`
  vocabulary (`KindsOf`/`HasKind`, kinds `Question`/`Permission`/`TaskComplete`/`Plan`) next to
  `CanonicalizeToolName`. Deleted the notifier's `QuestionToolNames`/`PermissionToolNames`/
  `TaskCompleteToolNames` maps and the indexer's `isPlanTool`; both now call `ingestkit.HasKind`.
  `task_complete`/`task-complete` map to both `TaskComplete` and `Plan` (preserving both modules'
  behaviour). New `toolkind_test.go` pins the union of all prior literals. **ATH-22:** `utils/diff.ts`
  deepened — `DiffHunk.lines` are structured `DiffLine{type,text,oldLine,newLine}`; text is now a
  single leaf (`serializeUnifiedDiff`) plus a data-boundary parse (`parseUnifiedDiff`), and `renderHunk`
  owns line/header bookkeeping. `mergeFileEdits` returns `hunks` (each with `messageIndex`); the
  `patch`/`perHunkPatches`/`perHunkMessageIndices` text fields are gone. `PatchRenderer` became
  `HunkRenderer` consuming structured hunks; `DiffView` search runs over hunk lines and `EditToolDiff`
  renders `computeDiff`/`parseUnifiedDiff` hunks directly (no component re-parses diff text). Tests:
  `utils/__tests__/diff.test.ts` covers compute/merge/serialize↔parse/render, plus component smoke
  tests for `DiffView` and `EditToolDiff`. Frontend gates green (`pnpm fmt`, `pnpm lint`, `pnpm test`,
  `pnpm build`) and `make test` green.
