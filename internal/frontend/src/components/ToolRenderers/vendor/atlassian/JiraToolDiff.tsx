import { useState } from "react";
import { Bug, FileText, CircleDot, Layers, ArrowRightToLine } from "lucide-react";
import type { ToolRendererProps } from "../../types";
import { MarkdownContent } from "../../../MarkdownContent";
import { CopyButton } from "../../../CopyButton";
import { BookmarkButton } from "../../BookmarkButton";

interface JiraIssueType {
  name: string;
  iconUrl?: string;
}

interface JiraStatusCategory {
  key: string;
  name: string;
  colorName: string;
}

interface JiraStatus {
  name: string;
  statusCategory?: JiraStatusCategory;
}

interface JiraUser {
  displayName?: string;
  emailAddress?: string;
}

interface JiraIssueFields {
  summary?: string;
  description?: string;
  issuetype?: JiraIssueType;
  status?: JiraStatus;
  parent?: JiraIssue;
  assignee?: JiraUser;
  priority?: { name?: string };
}

interface JiraIssue {
  key?: string;
  fields?: JiraIssueFields;
}

const ISSUE_TYPE_CONFIG: Record<
  string,
  { icon: typeof Bug; color: string; bg: string; border: string }
> = {
  bug: {
    icon: Bug,
    color: "text-rose-400",
    bg: "bg-rose-500/[0.08]",
    border: "border-rose-500/30",
  },
  story: {
    icon: FileText,
    color: "text-blue-400",
    bg: "bg-blue-500/[0.08]",
    border: "border-blue-500/30",
  },
  task: {
    icon: CircleDot,
    color: "text-gray-400",
    bg: "bg-gray-500/[0.08]",
    border: "border-gray-500/30",
  },
  epic: {
    icon: Layers,
    color: "text-violet-400",
    bg: "bg-violet-500/[0.08]",
    border: "border-violet-500/30",
  },
  subtask: {
    icon: ArrowRightToLine,
    color: "text-gray-400",
    bg: "bg-gray-500/[0.05]",
    border: "border-gray-500/20",
  },
  improvement: {
    icon: CircleDot,
    color: "text-emerald-400",
    bg: "bg-emerald-500/[0.08]",
    border: "border-emerald-500/30",
  },
};

const STATUS_COLOR_MAP: Record<string, string> = {
  "blue-gray": "bg-gray-500/20 text-gray-400",
  yellow: "bg-amber-500/20 text-amber-400",
  green: "bg-emerald-500/20 text-emerald-400",
};

function getIssueTypeConfig(name: string) {
  const key = name?.toLowerCase() || "";
  return ISSUE_TYPE_CONFIG[key] || ISSUE_TYPE_CONFIG.task;
}

function getStatusColor(status?: JiraStatus): string {
  const colorName = status?.statusCategory?.colorName || "blue-gray";
  return STATUS_COLOR_MAP[colorName] || STATUS_COLOR_MAP["blue-gray"];
}

const DESCRIPTION_LINE_LIMIT = 20;

export function JiraToolDiff({ tool, rawOutput, compact, onBookmark, isBookmarked }: ToolRendererProps) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  let issue: JiraIssue = {};
  let inputKey = "";
  let cloudId = "";

  try {
    const inputParsed = JSON.parse(tool.input);
    inputKey = inputParsed.issueIdOrKey || inputParsed.issueKey || "";
    cloudId = inputParsed.cloudId || "";
  } catch {
    /* ignore */
  }

  try {
    const output = rawOutput ?? tool.output;
    if (output) {
      const jsonStart = output.indexOf("{");
      const jsonStr = jsonStart >= 0 ? output.slice(jsonStart) : output;
      issue = JSON.parse(jsonStr);
    }
  } catch {
    /* ignore */
  }

  const issueKey = issue.key || inputKey || "";
  const summary = issue.fields?.summary || "";
  const description = issue.fields?.description || "";
  const issuetype = issue.fields?.issuetype;
  const status = issue.fields?.status;
  const parent = issue.fields?.parent;
  const assignee = issue.fields?.assignee;
  const priority = issue.fields?.priority;
  const typeConfig = getIssueTypeConfig(issuetype?.name || "task");
  const TypeIcon = typeConfig.icon;

  const jiraUrl = issueKey && cloudId.includes(".") ? `https://${cloudId}/browse/${issueKey}` : "";

  const descLines = description.split("\n");
  const needsTruncation = descLines.length > DESCRIPTION_LINE_LIMIT && !descriptionExpanded;

  const truncatedDescription = needsTruncation
    ? descLines.slice(0, DESCRIPTION_LINE_LIMIT).join("\n")
    : description;

  const formattedCopyText = issueKey ? `[${issueKey}] ${summary}` : tool.output || "";

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <TypeIcon size={12} className={`shrink-0 ${typeConfig.color}`} />
        <span className="font-semibold text-gh-text-secondary/70 shrink-0">jira:</span>
        <span className="text-gh-text truncate min-w-0">{issueKey || summary || "Jira issue"}</span>
        {status && (
          <span
            className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusColor(status)}`}
          >
            {status.name}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`border rounded-lg overflow-hidden mb-3 group ${typeConfig.border} ${typeConfig.bg}`}
    >
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary"
        style={{ borderColor: "inherit" }}
      >
        <TypeIcon size={14} className={`shrink-0 ${typeConfig.color}`} />
        {issuetype?.name && (
          <span
            className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${typeConfig.color} ${typeConfig.bg}`}
          >
            {issuetype.name}
          </span>
        )}
        {issueKey && jiraUrl ? (
          <a
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-accent hover:underline tracking-tight"
            onClick={(e) => e.stopPropagation()}
          >
            {issueKey}
          </a>
        ) : issueKey ? (
          <span className="font-bold text-gh-text tracking-tight">{issueKey}</span>
        ) : null}
        <div className="flex-1" />
        {status && (
          <span
            className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${getStatusColor(status)}`}
          >
            {status.name}
          </span>
        )}
        {onBookmark && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            <BookmarkButton isBookmarked={!!isBookmarked} onClick={onBookmark} />
          </span>
        )}
        <CopyButton text={formattedCopyText} />
      </div>

      {summary && (
        <div className="px-3 pt-2 pb-1">
          <h3 className="text-[13px] font-semibold text-gh-text leading-snug">{summary}</h3>
        </div>
      )}

      {(parent || assignee || priority) && (
        <div className="px-3 pb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gh-text-secondary">
          {parent && (
            <span>
              Epic:{" "}
              <a
                href={jiraUrl ? `https://${cloudId}/browse/${parent.key}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {parent.key}
              </a>{" "}
              {parent.fields?.summary?.slice(0, 60)}
            </span>
          )}
          {assignee?.displayName && <span>Assignee: {assignee.displayName}</span>}
          {priority?.name && <span>Priority: {priority.name}</span>}
        </div>
      )}

      {description && (
        <div className="px-3 pb-2">
          <div className="text-[11px] text-gh-text leading-relaxed markdown-body--inline">
            <MarkdownContent content={truncatedDescription} className="text-[11px]" />
          </div>
          {needsTruncation && (
            <span className="text-[10px] text-gh-text-secondary/60">
              … {descLines.length - DESCRIPTION_LINE_LIMIT} more lines{" "}
              <button
                type="button"
                onClick={() => setDescriptionExpanded(true)}
                className="text-accent hover:underline cursor-pointer"
              >
                Show more
              </button>
            </span>
          )}
          {descriptionExpanded && (
            <button
              type="button"
              onClick={() => setDescriptionExpanded(false)}
              className="mt-1 text-[10px] text-accent hover:underline cursor-pointer"
            >
              Show less
            </button>
          )}
        </div>
      )}

      {!summary && !description && (
        <div className="px-3 py-2 text-[11px] text-gh-text-secondary whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
          {tool.output.slice(0, 500)}
        </div>
      )}
    </div>
  );
}
