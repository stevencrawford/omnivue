# Contributing to sess

## Tool Call Renderer Plugin System

sess supports third-party tool call renderers via a plugin system. Renderers are auto-discovered at build time — no manual registration required.

### The `vendor/<namespace>/` convention

To add a custom renderer, create a directory under `internal/frontend/src/components/ToolRenderers/vendor/<namespace>/` containing:

1. One or more renderer components
2. An `index.ts` that exports `{ definitions: ToolRendererDefinition[] }`

The registry discovers all `vendor/*/index.ts` files via Vite's `import.meta.glob`.

### Minimal example

```
vendor/acme-corp/
├── index.ts
└── AcmeToolDiff.tsx
```

**`AcmeToolDiff.tsx`:**

```tsx
import type { ToolRendererProps } from "../types";

export function AcmeToolDiff({ tool, compact }: ToolRendererProps) {
  if (compact) {
    return <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono">acme: summary</div>;
  }
  return (
    <div className="border border-gh-border rounded-lg p-3">
      <pre>{tool.input}</pre>
      {tool.output && <pre>{tool.output}</pre>}
    </div>
  );
}
```

**`index.ts`:**

```tsx
import type { ToolRendererDefinition } from "../types";
import { AcmeToolDiff } from "./AcmeToolDiff";

export const definitions: ToolRendererDefinition[] = [
  {
    kind: "acme_tool",
    names: ["acme_tool", "acme_search"],
    Component: AcmeToolDiff,
    summary: (tool) => `acme: ${tool.name}`,
    markerColor: "#8b5cf6",
    markerLabel: "Acme",
    markerDisplayType: "search",
    markerPriority: 70,
    priority: 10, // vendor override priority
  },
];
```

### Key requirements

1. **Compact mode is required.** Every renderer must handle `compact: true` (one-line summary) and `compact: false` (full card). Use the `compact` prop to branch in your component.

2. **Never truncate output.** Set `truncateOutput` in the definition (default 200 lines). The system handles truncation and "Show more" UI uniformly. Set `truncateOutput: 0` to disable truncation entirely.

3. **Set marker priority.** Use the convention table below to choose a `markerPriority` that orders your renderer correctly in the scrollbar marker bar (lower = higher priority).

### Marker Priority Convention

| Priority range | Use case |
|---------------|----------|
| 0 | Task completion |
| 10 | Sub-agent/task delegation |
| 20-30 | File changes, plans |
| 40-60 | Questions, reads, commands |
| 70-80 | Searches, web access |
| 90-100 | Todo, deletions |
| **200+** | **Vendor-defined types** |

### Testing your renderer

1. `cd internal/frontend && pnpm run build` — TypeScript + Vite build
2. `cd internal/frontend && pnpm run lint` — no lint errors
3. Run `./sess --foreground --port 16275` and verify both compact (sidebar) and non-compact (conversation view) modes render correctly

### Backend normalization

If your renderer handles tool names not yet normalized by existing adapters, add cases in the relevant adapter package(s) under `internal/ingest/`:

- `opencode/opencode.go` — OpenCode adapter
- `copilot/copilot.go` — Copilot adapter
- `cursor/cursor.go` — Cursor adapter
- `pi/pi.go` — Pi adapter

## Build Commands

```bash
# Full build
make build

# Frontend only
cd internal/frontend && pnpm run build

# Tests
make test
# or
cd internal/frontend && pnpm run test

# Linting
make lint
# or
cd internal/frontend && pnpm run fmt
```
