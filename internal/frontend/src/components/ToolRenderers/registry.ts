import type { ToolCall } from "../../hooks/useApi";
import type { ToolRendererDefinition } from "./types";

interface RegistryModules {
  definitions?: ToolRendererDefinition[];
}

interface MarkerInfo {
  color: string;
  label: string;
  displayType: string;
  markerPriority: number;
}

const DEFAULT_MARKER_COLOR = "#6b7280";
const DEFAULT_MARKER_LABEL = "Other";
const DEFAULT_MARKER_DISPLAY_TYPE = "tool";
const DEFAULT_MARKER_PRIORITY = 1000;

class ToolRendererRegistry {
  private nameToKind: Map<string, string> = new Map();
  private definitions: Map<string, ToolRendererDefinition> = new Map();
  private initialised = false;

  init(): void {
    if (this.initialised) return;
    this.initialised = true;

    const modules = import.meta.glob<RegistryModules>(
      ["./builtin/index.ts", "./vendor/*/index.ts"],
      { eager: true },
    );

    for (const [path, mod] of Object.entries(modules)) {
      const defs = mod.definitions;
      if (!defs) continue;

      for (const def of defs) {
        this.registerDefinition(def, path);
      }
    }
  }

  private registerDefinition(def: ToolRendererDefinition, sourcePath: string): void {
    const kind = def.kind;
    const priority = def.priority ?? 0;

    const existing = this.definitions.get(kind);
    if (existing) {
      if (priority > existing.priority!) {
        this.replaceDefinition(kind, def);
      } else if (priority === existing.priority!) {
        console.warn(
          `[tool-renderers] Clash: ignoring 2nd definition for kind '${kind}' ` +
            `from ${sourcePath} (priority=${priority}). ${existing.kind} already registered.`,
        );
        return;
      }
      return;
    }

    this.definitions.set(kind, { ...def, priority: priority });

    for (const name of def.names) {
      const existingName = this.nameToKind.get(name);
      if (existingName && existingName !== kind) {
        console.warn(
          `[tool-renderers] Tool name '${name}' already mapped to kind '${existingName}'. ` +
            `Ignoring mapping from kind '${kind}'.`,
        );
        continue;
      }
      this.nameToKind.set(name, kind);
    }
  }

  private replaceDefinition(kind: string, def: ToolRendererDefinition): void {
    this.definitions.set(kind, { ...def, priority: def.priority ?? 0 });
    for (const name of def.names) {
      this.nameToKind.set(name, kind);
    }
  }

  getRenderer(kind: string): ToolRendererDefinition | undefined {
    this.init();
    return this.definitions.get(kind);
  }

  kindForToolName(name: string): string | undefined {
    this.init();
    return this.nameToKind.get(name);
  }

  effectiveToolKind(tool: ToolCall): string | undefined {
    this.init();
    const fromName = this.nameToKind.get(tool.name);
    if (fromName) return fromName;
    return undefined;
  }

  getSummary(tool: ToolCall, agent?: string): string | undefined {
    this.init();
    const kind = this.effectiveToolKind(tool) ?? tool.name;
    const def = this.definitions.get(kind);
    if (def?.summary) {
      return def.summary(tool, agent);
    }
    return undefined;
  }

  markerForKind(kind: string): MarkerInfo {
    this.init();
    const def = this.definitions.get(kind);
    if (!def) {
      return {
        color: DEFAULT_MARKER_COLOR,
        label: DEFAULT_MARKER_LABEL,
        displayType: DEFAULT_MARKER_DISPLAY_TYPE,
        markerPriority: DEFAULT_MARKER_PRIORITY,
      };
    }
    return {
      color: def.markerColor ?? DEFAULT_MARKER_COLOR,
      label: def.markerLabel ?? DEFAULT_MARKER_LABEL,
      displayType: def.markerDisplayType ?? DEFAULT_MARKER_DISPLAY_TYPE,
      markerPriority: def.markerPriority ?? DEFAULT_MARKER_PRIORITY,
    };
  }

  allMarkerDisplayTypes(): Array<{ displayType: string; markerPriority: number }> {
    this.init();
    const seen = new Map<string, number>();
    for (const def of this.definitions.values()) {
      const dt = def.markerDisplayType ?? DEFAULT_MARKER_DISPLAY_TYPE;
      const mp = def.markerPriority ?? DEFAULT_MARKER_PRIORITY;
      if (!seen.has(dt) || mp < seen.get(dt)!) {
        seen.set(dt, mp);
      }
    }
    return Array.from(seen.entries())
      .map(([displayType, markerPriority]) => ({ displayType, markerPriority }))
      .sort((a, b) => a.markerPriority - b.markerPriority);
  }
}

export const toolRendererRegistry = new ToolRendererRegistry();
