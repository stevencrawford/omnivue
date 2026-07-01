# Tool Call Renderers — Architecture Guide

This file explains how tool call rendering works in the frontend, the plugin architecture, and how to add new renderers.

## Architecture Overview

Tool calls from all agents (OpenCode, Copilot, Cursor) are normalized to a common `ToolCall` type and rendered by specialized components through a registry-based plugin system.

```
ToolCall (from API)
  │
  ▼
ToolCallList.tsx
  │  uses effectiveToolKind(tool) via toolDisplay.ts
  │  then toolRendererRegistry.getRenderer(kind)
  │
  └── ToolRendererWrapper (system-level truncation + chevron toggle)
       │
       └── renderer Component (variant=summary or variant=detail)
```

### Registry Auto-Discovery

The `ToolRendererRegistry` in `registry.ts` uses Vite's `import.meta.glob` to discover renderer definitions:

- `./builtin/index.ts` — built-in renderers (always loaded)
- `./vendor/*/index.ts` — third-party renderers (auto-discovered)

Each discovered module must export a `definitions: ToolRendererDefinition[]` array.

## ToolRendererDefinition Interface

```typescript
interface ToolRendererDefinition {
  kind: string; // canonical kind (e.g. "bash", "edit")
  names: string[]; // tool names mapping to this kind
  Component: ComponentType<ToolRendererProps>;
  summary?: (tool: ToolCall, agent?: string) => string;
  display: ToolCardDisplay; // display behavior (see below)
  markerColor?: string; // hex color for scrollbar marker
  markerLabel?: string; // human-readable label for marker legend
  markerDisplayType?: string; // grouping key for markers
  markerPriority?: number; // lower = higher in marker bar
  priority?: number; // override priority (builtin=0, vendor=10)
  truncateOutput?: number; // max output lines (default 50, 0 = no truncation)
  cardClassName?: string; // custom card CSS (primarily for always-open cards)
}
```

### ToolCardDisplay — Polymorphic Display Modes

```typescript
type ToolCardDisplay =
  | {
      type: "expandable";
      /** Card starts open (default: false). A chevron toggle is shown. */
      defaultOpen?: boolean;
    }
  | {
      type: "always-open";
      /** No chevron toggle. Content always visible, bypasses summary mode. */
    };
```

| `display.type`  | Summary (`variant="summary"`)                                            | Detail (`variant="detail"`)     | Chevron? |
| --------------- | ------------------------------------------------------------------------ | ------------------------------- | -------- |
| `"expandable"`  | Card with chevron toggle; `defaultOpen` controls initial state           | Content renders inline          | ✅       |
| `"always-open"` | **Bypassed** — always renders in detail mode with actions but no chevron | Full content, card with actions | ❌       |

### Override Rules

| Scenario                                            | Outcome                                |
| --------------------------------------------------- | -------------------------------------- |
| Vendor registers `kind: "bash"` with `priority: 10` | Replaces builtin `bash` (priority 0)   |
| Vendor registers `kind: "bash"` with `priority: 0`  | `console.warn("Clash")` — builtin wins |
| Vendor registers new `kind: "jira_create_issue"`    | Registered as new kind                 |
| Tool name `"jira_create_issue"`                     | Maps to kind `"jira_create_issue"`     |

### Summary/Detail Variant Contract

Every renderer is a single component that handles both modes via the required `variant` prop:

| Prop value          | Expected output                                     |
| ------------------- | --------------------------------------------------- |
| `variant="summary"` | Single-line summary (text + icon), no borders/cards |
| `variant="detail"`  | Full card with rich detail                          |

If a renderer has no meaningful summary representation, render a minimal one-line fallback (e.g., kind label with truncated summary).

### Expand/Truncation Behavior

`ToolRendererWrapper` controls two independent state flags per card:

- **`open`** — Whether the card is showing its content area or only the summary header. Controlled by the chevron toggle.
- **`showFullOutput`** — Whether the expanded output is truncated at `truncateOutput` lines or shown in full. Reset to "truncated" each time the card is closed and reopened.

| `display.type`  | `defaultOpen`     | Behavior                                        |
| --------------- | ----------------- | ----------------------------------------------- |
| `"expandable"`  | `false` (default) | Collapsed card with chevron; click to expand    |
| `"expandable"`  | `true`            | Open card with chevron; click to collapse       |
| `"always-open"` | ignored           | Card border + summary line + actions, no toggle |

When `display.type` is `"always-open"`, the card still renders with a border, copy/bookmark buttons, and duration display — it simply has no chevron toggle or expandable content section. These cards also bypass the `variant` system entirely — they always render in detail mode.

### Truncation Policy

Truncation is always system-level via `ToolRendererWrapper`:

- `truncateOutput` field (default 50) controls max output lines
- The system truncates `tool.output` before the component receives it
- Renderers must never truncate their own output
- System handles "Show more/less" expand/collapse UI uniformly
- Set `truncateOutput: 0` to disable truncation

**Note for computed content:** Renderers that compute and render derived visuals (e.g., diff patches from input fields) may use CSS-level visual containment (`max-h` + `overflow-y-auto`) to manage the height of large derived output. This is distinct from `tool.output` text truncation, which must always remain system-level.

### onCopy Prop

Renderers receive an optional `onCopy` prop for content-specific copy (e.g., copying just the command text, not the full output). Call `onCopy(string)` to trigger the system's copy mechanism.

## Adding a New Renderer

### Option A: Built-in renderer

1. Create `builtin/MyToolDiff.tsx` following the `ToolRendererProps` interface
2. Export from `builtin/index.ts` by adding to the `definitions` array

### Option B: Vendor renderer (third-party)

1. Create `vendor/<namespace>/MyToolDiff.tsx` following `ToolRendererProps`
2. Create `vendor/<namespace>/index.ts` exporting `{ definitions: [...] }`
3. No manual registration — the registry auto-discovers it

### What the renderer must handle

- Both `variant="summary"` and `variant="detail"` modes via `ToolRendererProps.variant`
- Accept (but can ignore) `onOpenModal`, `onPin`, `onCopy` props
- Never truncate output — set `truncateOutput` in the definition instead

### What the system handles automatically

- Truncation + "Show more/less" button (via `ToolRendererWrapper`)
- Copy of full output via `CopyOutputBtn` in the card header row
- Bookmark button in the card header row
- Duration display (via `ToolCallRow` header)
- Sub-agent session "View" link (via `ToolCallRow` header)

## Builtin Renderer Reference

| Kind                         | Component                                       | `display` type | `defaultOpen` | `truncateOutput` | `markerPriority` |
| ---------------------------- | ----------------------------------------------- | -------------- | ------------- | ---------------- | ---------------- |
| `task_complete`              | `TaskCompleteToolDiff`                          | `always-open`  | N/A           | 0 (none)         | 0                |
| `task`                       | `TaskToolDiff`                                  | `expandable`   | `false`       | 50 (default)     | 10               |
| `edit`, `write`              | `EditToolDiff`                                  | `expandable`   | `true`        | 20               | 20               |
| `exit_plan_mode`             | `ExitPlanModeToolDiff`                          | `always-open`  | N/A           | 0 (none)         | 30               |
| `question`                   | `QuestionToolDiff`                              | `expandable`   | `true`        | 50 (default)     | 40               |
| `read`                       | `ReadToolDiff`                                  | `expandable`   | `false`       | 50 (default)     | 50               |
| `bash`                       | `BashToolDiff`                                  | `expandable`   | `false`       | 50               | 60               |
| `grep`, `glob`, `codesearch` | `GrepToolDiff`/`GlobToolDiff`/`DefaultToolDiff` | `expandable`   | `false`       | 50               | 70               |
| `webfetch`, `websearch`      | `DefaultToolDiff`                               | `expandable`   | `false`       | 50 (default)     | 80               |
| `todowrite`                  | `TodoWriteToolDiff`                             | `expandable`   | `true`        | 50 (default)     | 90               |
| `delete`                     | `DeleteToolDiff`                                | `expandable`   | `false`       | 50 (default)     | 100              |
| `compaction`                 | `CompactionToolDiff`                            | `always-open`  | N/A           | 0 (none)         | 110              |

> **Note:** `task_complete` and `exit_plan_mode` and `compaction` use `display: { type: "always-open" }` — they are self-contained cards that provide their own border/background and always render full content regardless of variant.

### Compaction pattern

The `compaction` kind is a special visual separator used when multiple tool calls of the same kind are collapsed into a single group. It renders a horizontal rule with a centered badge (e.g. `─── 3 reads ───`). Its input is `{ kind, count, label }`. Uses `display: { type: "always-open" }` with `truncateOutput: 0`.

## Styling Conventions

Use GitHub-style CSS classes from Tailwind (gh-border, gh-bg-secondary, etc.). Each kind can use a distinct border/icon color:

| Kind(s)          | Border/Accent                 |
| ---------------- | ----------------------------- |
| `bash`           | amber                         |
| `edit`/`write`   | accent (green/blue)           |
| `read`           | cyan                          |
| `grep`/`glob`    | violet                        |
| `delete`         | red                           |
| `todowrite`      | amber                         |
| `task`           | violet                        |
| `question`       | orange                        |
| `exit_plan_mode` | amber (self-contained card)   |
| `task_complete`  | emerald (self-contained card) |
| `compaction`     | gray                          |

## CopyButton Usage

Built-in renderers can import `CopyButton` from `../../CopyButton` for content-specific copy buttons. Vendor renderers can do the same or use the `onCopy` prop.
