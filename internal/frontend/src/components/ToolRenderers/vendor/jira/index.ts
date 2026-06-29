import type { ToolRendererDefinition } from "../../types";
import { extractJSONField } from "../../../utils/jsonField";
import { JiraToolDiff } from "./JiraToolDiff";

export const definitions: ToolRendererDefinition[] = [
  {
    kind: "jira_get_issue",
    names: ["jira_get_issue"],
    Component: JiraToolDiff,
    summary: (tool) => {
      const key = extractJSONField(tool.input, "issueIdOrKey") ||
        extractJSONField(tool.input, "issueKey") || "";
      return key ? `jira: ${key}` : "jira_get_issue";
    },
    markerColor: "#0052CC",
    markerLabel: "Jira",
    markerDisplayType: "search",
    markerPriority: 70,
    priority: 10,
  },
];
