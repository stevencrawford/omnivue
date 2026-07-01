import type { ComponentType } from "react";
import type { ToolCall } from "../../hooks/useApi";

export type ToolCardDisplay =
  | { type: "expandable"; defaultOpen?: boolean }
  | {
      type: "always-open";
      /**
       * Render the component in summary mode inside the system card.
       * When false (default), the component renders its own full card chrome.
       */
      renderSummary?: boolean;
    };

export interface ToolRendererProps {
  tool: ToolCall;
  /** Full, untruncated output text (when tool.output may be truncated for display). */
  rawOutput?: string;
  variant: "summary" | "detail";
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onCopy?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
  /** Child session ID for sub-agent task tool calls (used for "View session" button). */
  childSessionId?: string | null;
  /** Navigate to a session by ID. */
  navigateToSession?: (id: string) => void;
}

export interface ToolRendererDefinition {
  kind: string;
  names: string[];
  Component: ComponentType<ToolRendererProps>;
  summary?: (tool: ToolCall, agent?: string) => string;
  display: ToolCardDisplay;
  markerColor?: string;
  markerLabel?: string;
  markerDisplayType?: string;
  markerPriority?: number;
  priority?: number;
  truncateOutput?: number;
  cardClassName?: string;
}
