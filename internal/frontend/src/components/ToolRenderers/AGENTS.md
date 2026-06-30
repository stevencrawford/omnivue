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
  └── ToolRendererWrapper (system-level truncation + expand toggle)
       │
       └── renderer Component (compact or non-compact)
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
  markerColor?: string; // hex color for scrollbar marker
  markerLabel?: string; // human-readable label for marker legend
  markerDisplayType?: string; // grouping key for markers
  markerPriority?: number; // lower = higher in marker bar
  priority?: number; // override priority (builtin=0, vendor=10)
  truncateOutput?: number; // max output lines (default 50, 0 = no truncation)
  defaultExpanded?: boolean; // start with card open (default: false)
  canExpand?: boolean; // allow expand/collapse (default: true).
  // When false, compact mode renders the card
  // border + compact line + actions (copy,
  // bookmark, duration) but no chevron toggle
  // or expandable section.
}
```

### Override Rules

| Scenario                                            | Outcome                                |
| --------------------------------------------------- | -------------------------------------- |
| Vendor registers `kind: "bash"` with `priority: 10` | Replaces builtin `bash` (priority 0)   |
| Vendor registers `kind: "bash"` with `priority: 0`  | `console.warn("Clash")` — builtin wins |
| Vendor registers new `kind: "jira_create_issue"`    | Registered as new kind                 |
| Tool name `"jira_create_issue"`                     | Maps to kind `"jira_create_issue"`     |

### Compact Mode Contract

Every renderer is a single component that handles both modes via the required `compact` prop:

| Prop value       | Expected output                                     |
| ---------------- | --------------------------------------------------- |
| `compact: true`  | Single-line summary (text + icon), no borders/cards |
| `compact: false` | Full card with rich detail                          |

If a renderer has no meaningful compact representation, render a minimal one-line fallback (e.g., kind label with truncated summary).

### Expand/Truncation Behavior

`ToolRendererWrapper` controls two independent state flags per card:

- **`expanded`** — Whether the card is open (showing expanded content)
  or closed (showing only the compact line). Controlled by the
  chevron toggle.
- **`truncExpanded`** — Whether the expanded output is truncated at
  `truncateOutput` lines or shown in full. Reset to "truncated" each
  time the card is closed and reopened.

| `canExpand` | `defaultExpanded` | Behavior                                        |
| ----------- | ----------------- | ----------------------------------------------- |
| `true`      | `false` (default) | Collapsed card with chevron; click to expand    |
| `true`      | `true`            | Open card with chevron; click to collapse       |
| `false`     | ignored           | Card border + compact line + actions, no toggle |

When `canExpand` is `false`, the card still renders with a border,
copy/bookmark buttons, and duration display — it simply has no
chevron toggle or expandable content section.

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

### Option B: Vendor/renderer (third-party)

1. Create `vendor/<namespace>/MyToolDiff.tsx` following `ToolRendererProps`
2. Create `vendor/<namespace>/index.ts` exporting `{ definitions: [...] }`
3. No manual registration — the registry auto-discovers it

### What the renderer must handle

- Both `compact` and non-compact modes via `ToolRendererProps.compact`
- Accept (but can ignore) `onOpenModal`, `onPin`, `onCopy` props
- Never truncate output — set `truncateOutput` in the definition instead

### What the system handles automatically

- Truncation + "Show more/less" button (via `ToolRendererWrapper`)
- Copy of full output via `CopyOutputBtn` in the compact header row
- Bookmark button in the compact header row
- Duration display (via `ToolCallRow` header)
- Sub-agent session "View" link (via `ToolCallRow` header)

## Builtin Renderer Reference

| Kind                         | Component                                       | `truncateOutput` | `defaultExpanded` | `canExpand` | `markerPriority` |
| ---------------------------- | ----------------------------------------------- | ---------------- | ----------------- | ----------- | ---------------- |
| `task_complete`              | `TaskCompleteToolDiff`                          | 0 (none)         | `false`           | `false`     | 0                |
| `task`                       | `TaskToolDiff`                                  | 50 (default)     | `false`           | `false`     | 10               |
| `edit`, `write`              | `EditToolDiff`                                  | 20               | `true`            | `true`      | 20               |
| `exit_plan_mode`             | `ExitPlanModeToolDiff`                          | 50 (default)     | `false`           | `true`      | 30               |
| `question`                   | `QuestionToolDiff`                              | 50 (default)     | `false`           | `true`      | 40               |
| `read`                       | `ReadToolDiff`                                  | 50 (default)     | `false`           | `true`      | 50               |
| `bash`                       | `BashToolDiff`                                  | 50               | `false`           | `true`      | 60               |
| `grep`, `glob`, `codesearch` | `GrepToolDiff`/`GlobToolDiff`/`DefaultToolDiff` | 50               | `false`           | `true`      | 70               |
| `webfetch`, `websearch`      | `DefaultToolDiff`                               | 50 (default)     | `false`           | `true`      | 80               |
| `todowrite`                  | `TodoWriteToolDiff`                             | 50 (default)     | `true`            | `true`      | 90               |
| `delete`                     | `DeleteToolDiff`                                | 50 (default)     | `false`           | `true`      | 100              |
| `compaction`                 | `CompactionToolDiff`                            | 0 (none)         | `false`           | `false`     | 110              |

> **Note:** `task_complete` is a self-contained card in non-compact mode — it provides its own emerald border/background. This is because the non-compact rendering bypasses `ToolRendererWrapper`'s card wrapper and renders the component directly.

### Compaction pattern

The `compaction` kind is a special visual separator used when
multiple tool calls of the same kind are collapsed into a single
group. It renders a horizontal rule with a centered badge
(e.g. `─── 3 reads ───`). Its input is `{ kind, count, label }`.
Set `canExpand: false` and `truncateOutput: 0` for this pattern.

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
| `exit_plan_mode` | amber                         |
| `task_complete`  | emerald (self-contained card) |
| `compaction`     | gray                          |

## CopyButton Usage

Built-in renderers can import `CopyButton` from `../../CopyButton` for content-specific copy buttons. Vendor renderers can do the same or use the `onCopy` prop.
