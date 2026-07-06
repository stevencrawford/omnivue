import { ArrowRightLeft } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { extractJSONField } from "../../../utils/jsonField";

export function ModelSwitchToolDiff({ tool, variant }: ToolRendererProps) {
  const model = extractJSONField(tool.input, "model") || "";
  const provider = extractJSONField(tool.input, "provider") || "";

  const shortName = model.split("/").pop() || model || "Unknown model";

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <ArrowRightLeft size={12} className="text-blue-400 shrink-0" />
        <span className="text-blue-400 font-semibold shrink-0 truncate">{shortName}</span>
      </div>
    );
  }

  return (
    <div className="border border-blue-500/30 rounded-lg overflow-hidden bg-blue-500/[0.04] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-blue-500/20" />
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowRightLeft size={12} className="text-blue-400" />
            <span className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider select-none">
              {shortName}
            </span>
            {provider && (
              <span className="text-[10px] text-ov-text-secondary/50 ml-0.5">({provider})</span>
            )}
          </div>
          <div className="flex-1 h-px bg-blue-500/20" />
        </div>
      </div>
    </div>
  );
}
