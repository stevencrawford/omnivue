import type { ToolRendererDefinition } from "../../types";
import { ExampleToolDiff } from "./ExampleToolDiff";

export const definitions: ToolRendererDefinition[] = [
  {
    kind: "example",
    names: ["example_tool", "example_query"],
    Component: ExampleToolDiff,
    summary: (tool) => `example: ${tool.name}`,
    markerColor: "#8b5cf6",
    markerLabel: "Example",
    markerDisplayType: "search",
    markerPriority: 200,
    priority: 10,
  },
];
