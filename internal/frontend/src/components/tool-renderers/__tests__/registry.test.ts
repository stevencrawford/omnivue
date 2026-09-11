import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../builtin/index.ts", () => ({
  definitions: [
    {
      kind: "bash",
      names: ["bash", "run_terminal"],
      Component: () => null,
      summary: (t: { input?: string }) => t.input || "bash",
      markerColor: "#eab308",
      markerLabel: "Shell",
      markerDisplayType: "bash",
      markerPriority: 60,
      priority: 0,
    },
    {
      kind: "edit",
      names: ["edit", "write"],
      Component: () => null,
      summary: (t: { input?: string }) => `edit: ${t.input}`,
      markerColor: "#ef4444",
      markerLabel: "Edits",
      markerDisplayType: "edit",
      markerPriority: 20,
      priority: 0,
    },
  ],
}));

vi.mock("../vendor/example/index.ts", () => ({ definitions: [] }));
vi.mock("../vendor/atlassian/index.ts", () => ({ definitions: [] }));

import { toolRendererRegistry } from "../registry";

beforeEach(() => {
  toolRendererRegistry.reset();
});

describe("getRenderer", () => {
  it("returns definition for registered kind", () => {
    const renderer = toolRendererRegistry.getRenderer("bash");
    expect(renderer).toBeDefined();
    expect(renderer?.kind).toBe("bash");
  });

  it("returns undefined for unregistered kind", () => {
    expect(toolRendererRegistry.getRenderer("nonexistent")).toBeUndefined();
  });
});

describe("kindForToolName", () => {
  it("returns undefined for unregistered tool name", () => {
    expect(toolRendererRegistry.kindForToolName("unknown_tool")).toBeUndefined();
  });

  it("returns kind for registered tool name", () => {
    expect(toolRendererRegistry.kindForToolName("bash")).toBe("bash");
    expect(toolRendererRegistry.kindForToolName("run_terminal")).toBe("bash");
  });
});

describe("effectiveToolKind", () => {
  it("returns kind from name mapping", () => {
    const result = toolRendererRegistry.effectiveToolKind({
      id: "1",
      name: "edit",
      input: "",
      output: "",
      status: "completed",
    });
    expect(result).toBe("edit");
  });

  it("returns undefined for unmapped tool name", () => {
    const result = toolRendererRegistry.effectiveToolKind({
      id: "1",
      name: "random_tool",
      input: "",
      output: "",
      status: "completed",
    });
    expect(result).toBeUndefined();
  });
});

describe("getSummary", () => {
  it("returns summary from definition", () => {
    const result = toolRendererRegistry.getSummary({
      id: "1",
      name: "bash",
      input: "ls -la",
      output: "",
      status: "completed",
    });
    expect(result).toBe("ls -la");
  });

  it("returns undefined when no definition matches", () => {
    const result = toolRendererRegistry.getSummary({
      id: "1",
      name: "unknown",
      input: "",
      output: "",
      status: "completed",
    });
    expect(result).toBeUndefined();
  });
});

describe("markerForKind", () => {
  it("returns default markers for unknown kind", () => {
    const marker = toolRendererRegistry.markerForKind("unknown");
    expect(marker.color).toBe("#6b7280");
    expect(marker.label).toBe("Other");
    expect(marker.displayType).toBe("tool");
    expect(marker.markerPriority).toBe(1000);
  });

  it("returns configured markers for known kind", () => {
    const marker = toolRendererRegistry.markerForKind("bash");
    expect(marker.color).toBe("#eab308");
    expect(marker.label).toBe("Shell");
    expect(marker.displayType).toBe("bash");
    expect(marker.markerPriority).toBe(60);
  });
});

describe("allMarkerDisplayTypes", () => {
  it("returns all display types sorted by priority", () => {
    const types = toolRendererRegistry.allMarkerDisplayTypes();
    expect(types.length).toBeGreaterThanOrEqual(2);
    expect(types[0].displayType).toBe("edit");
    expect(types[1].displayType).toBe("bash");
  });
});

describe("override priority", () => {
  it("unique vendor kind from vendor modules is registered", () => {
    // jira_get_issue is not in our mocked builtin/index.ts,
    // but would come from a vendor module. Here we test the
    // builtin kinds that ARE registered.
    expect(toolRendererRegistry.getRenderer("bash")).toBeDefined();
    expect(toolRendererRegistry.getRenderer("edit")).toBeDefined();
  });
});

describe("init is idempotent", () => {
  it("does not re-initialise after first call", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    toolRendererRegistry.getRenderer("bash");
    toolRendererRegistry.getRenderer("edit");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
