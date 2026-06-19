# Tool Call Renderers — Architecture Guide

This file explains how tool call rendering works in the frontend, the renderer taxonomy, and how to add new renderers.

## Architecture Overview

Tool calls from all agents (OpenCode, Copilot, Cursor) are normalized to a common `ToolCall` type and rendered by specialized components.

```
ToolCall (from API)
  │
  ▼
ToolCallList.tsx
  │  uses effectiveToolKind(tool) to determine renderer
  │
  ├── BashToolDiff          command execution
  ├── EditToolDiff          file edit (oldStr → newStr) / file write
  ├── ReadToolDiff          file read
  ├── GrepToolDiff          text search results
  ├── GlobToolDiff          file pattern search results
  ├── DeleteToolDiff        file deletion
  ├── TodoWriteToolDiff     todo list updates
  ├── TaskToolDiff          sub-agent task delegation
  ├── QuestionToolDiff      user questions with options
  ├── ExitPlanModeToolDiff  plan mode exit with summary
  └── DefaultToolDiff       generic fallback (collapsible input/output)
```

## Tool Kind Taxonomy

The `effectiveToolKind()` function in `utils/toolDisplay.ts` maps tool names and input shapes to a standard kind (the key used for renderer dispatch):

| Kind | Expected in ToolCall.name | Renderer |
|------|--------------------------|----------|
| `bash` | `bash`, `run_terminal_command_v2`, or input contains `command` field | `BashToolDiff` |
| `edit` | `edit`, `edit_file_v2`, `create`, or input contains `filePath` + no offset | `EditToolDiff` |
| `write` | `write`, `create` | `EditToolDiff` (same component as edit) |
| `read` | `read`, `read_file_v2`, `view`, or input contains `filePath` + `offset`/`limit` | `ReadToolDiff` |
| `grep` | `grep`, `ripgrep_raw_search`, or input contains `pattern`/`query` | `GrepToolDiff` |
| `glob` | `glob`, `glob_file_search`, or input contains `pattern` | `GlobToolDiff` |
| `delete` | `delete`, `delete_file` | `DeleteToolDiff` |
| `todowrite` | `todowrite` | `TodoWriteToolDiff` |
| `task` | `task` | `TaskToolDiff` |
| `question` | `question` | `QuestionToolDiff` |
| `exit_plan_mode` | `exit_plan_mode` | `ExitPlanModeToolDiff` |
| `task_complete` | `task_complete` | Special block in `ToolCallList` (not a separate renderer) |
| *other* | unknown name, no matching fields | `DefaultToolDiff` (collapsible input/output) |

## Renderer Component Interface

Every renderer follows this convention:

```tsx
interface Props {
  tool: ToolCall;
  onOpenModal?: (content: string, title?: string) => void;  // optional fullscreen view
  compact?: boolean;  // optional compact mode for sidebar preview
}

export function MyToolDiff({ tool, onOpenModal, compact }: Props) {
  // ...
}
```

### Common Patterns

**1. Parse input JSON** at the top of the component:

```tsx
let input: MyInput = {};
try {
  input = JSON.parse(tool.input);
} catch {
  /* ignore */
}
```

**2. Use semantic border/icon colors** to indicate tool type:

| Tool kind | Border | Icon color |
|-----------|--------|------------|
| `bash` | red (command) | red |
| `edit`/`write` | green (file change) | emerald |
| `read` | neutral | default |
| `grep`/`glob` | neutral | default |
| `delete` | red (danger) | red |
| `todowrite` | neutral | default |
| `task` | violet (sub-agent) | violet |
| `question` | neutral | default |
| `exit_plan_mode` | amber (plan) | amber |

Pattern for border styling:

```tsx
<div className="border border-{color}-500/30 rounded-lg overflow-hidden mb-3 bg-{color}-500/[0.03] group">
```

**3. Wrap long output** with truncation:

```tsx
const MAX_LINES = 200;
const lines = output.split("\n");
const display = lines.length > MAX_LINES
  ? lines.slice(0, MAX_LINES).join("\n") + `\n\n... (${lines.length - MAX_LINES} more lines)`
  : output;
```

**4. Use `CopyButton`** for copyable content:

```tsx
import { CopyButton } from "../CopyButton";
<CopyButton text={content} />
```

**5. Use `detectLanguage`** for syntax-highlighted file previews (edit, write, read renderers):

```tsx
import { detectLanguage } from "../../utils/detectLanguage";
const lang = detectLanguage(filePath);
```

**6. Use `computeDiff`** for edit renderers to show oldStr→newStr patches:

```tsx
import { computeDiff } from "../../utils/diff";
const diffLines = computeDiff(oldStr, newStr);
```

## Adding a New Renderer

### Step 1: Add the kind to effectiveToolKind

In `utils/toolDisplay.ts`, add the tool name to the switch statement in `effectiveToolKind()`:

```tsx
case "my_new_tool":
  return "my_new_tool";
```

### Step 2: Add summary support to getToolSummary

In `utils/toolDisplay.ts`, add a case to `getToolSummary()`:

```tsx
if (kind === "my_new_tool") {
  const detail = extractJSONField(input, "detail") || "";
  return `my_new_tool: ${detail.slice(0, 80)}`;
}
```

### Step 3: Create the renderer component

Create `MyNewToolDiff.tsx` in this directory. Follow the conventions above for input parsing, styling, and copy support.

### Step 4: Register in ToolCallList

In `ToolCallList.tsx`:
1. Import the component
2. Add the case in the compact switch:
   ```tsx
   case "my_new_tool":
     return <MyNewToolDiff tool={tool} />;
   ```
3. In the expanded `ToolCallRow`, it will automatically fall through to the wrapper—no change needed for non-compact mode unless you need special rendering.

### Step 5: Handle backend normalization

Ensure the adapter normalizes the agent's native tool name to your new kind name. For Cursor, add a case in `normalizeToolCall()` in `internal/ingest/cursor/cursor.go`. For OpenCode, the names are already standard.

## Dispatch Logic in Detail

The `ToolCallList` component renders tool calls in two modes:

### Compact mode (sidebar preview)
Directly renders the specialized component without expand/collapse controls. Each kind returns its most compact visual representation:
- `bash` → one-line command with exit status
- `edit` → file path with diff summary
- `read` → file path with line range
- `grep`/`glob` → pattern with result count
- Default → kind:summary line

### Non-compact mode (full conversation view)
Renders each tool call in an expandable wrapper:
1. Row header: icon + status + summary + duration + copy button + optional "View" link
2. Expandable section: input/output data blocks with expand/collapse for long content

Special cases:
- `task` — violet theme, sub-agent session navigation link
- `task_complete` — emerald theme, always expanded summary block

## Styling Constants

```tsx
// Standard tool wrapper
"border border-gh-border rounded-lg overflow-hidden mb-3 bg-gh-bg-secondary/50"

// Standard tool row button
"flex items-center gap-2 flex-1 min-w-0 px-2.5 py-1.5 text-left cursor-pointer hover:bg-gh-bg-hover transition-colors"

// Compact tool margin
"mb-3"
```

## Existing Renderer Reference

| File | Lines | Complexity | Notes |
|------|-------|-----------|-------|
| `BashToolDiff.tsx` | ~140 | Medium | Command display, exit code, output truncation |
| `EditToolDiff.tsx` | ~150 | High | Diff computation, file preview, view_range |
| `ReadToolDiff.tsx` | ~90 | Low | File content preview |
| `GrepToolDiff.tsx` | ~100 | Low | Pattern display, match count |
| `GlobToolDiff.tsx` | ~90 | Low | Pattern display, file count |
| `DeleteToolDiff.tsx` | ~35 | Low | Simple file path display |
| `TodoWriteToolDiff.tsx` | ~83 | Low | Status indicators (completed/in-progress/pending) |
| `TaskToolDiff.tsx` | ~83 | Medium | Sub-agent delegation, session navigation link |
| `QuestionToolDiff.tsx` | ~99 | Low | Question display, option rendering |
| `ExitPlanModeToolDiff.tsx` | ~50 | Medium | Plan summary markdown rendering |
| `ToolCallList.tsx` | ~331 | High | Dispatch logic, expand/collapse, data blocks, task_complete special-case |
