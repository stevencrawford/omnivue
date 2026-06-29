import type { ComponentType } from "react";
import type { ToolCall } from "../../hooks/useApi";

export interface ToolRendererProps {
  tool: ToolCall;
  compact: boolean;
  onOpenModal?: (content: string, title?: string) => void;
  onPin?: (content: string) => void;
  onCopy?: (content: string) => void;
  onBookmark?: () => void;
  isBookmarked?: boolean;
}

export interface ToolRendererDefinition {
  kind: string;
  names: string[];
  Component: ComponentType<ToolRendererProps>;
  summary?: (tool: ToolCall, agent?: string) => string;
  markerColor?: string;
  markerLabel?: string;
  markerDisplayType?: string;
  markerPriority?: number;
  priority?: number;
  truncateOutput?: number;
  defaultExpanded?: boolean;
  canExpand?: boolean;
}
