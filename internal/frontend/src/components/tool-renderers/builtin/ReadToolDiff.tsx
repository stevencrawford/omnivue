import { BookOpen } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { detectLanguage } from "../../../utils/detectLanguage";
import { FileRenderer } from "../../DiffRenderer";

interface ReadInput {
  filePath?: string;
  file_path?: string;
  path?: string;
  offset?: number;
  limit?: number;
}

export function ReadToolDiff({
  tool,
  variant,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let input: ReadInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.file_path || input.path || "";
  const offset = input.offset ?? 1;
  const limit = input.limit ?? 0;
  const showLineRange = limit > 0;
  const lang = detectLanguage(filePath);

  const baseName = filePath.split("/").pop() || filePath;

  const content = tool.output || "";
  const cleanContent = content
    .replace(/^<file>\n?/, "")
    .replace(/\n<\/file>\s*$/, "")
    .replace(/^<path>.*<\/path>\n?/gm, "")
    .replace(/^<type>.*<\/type>\n?/gm, "")
    .replace(/^<content>\n?/gm, "")
    .replace(/\n<\/content>\s*$/gm, "")
    .replace(/^[0-9]{5}\| ?/gm, "");

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <BookOpen size={12} className="text-cyan-400 shrink-0" />
        <span className="text-ov-text-secondary/70 shrink-0">read:</span>
        <span className="text-ov-text truncate min-w-0" title={filePath}>
          {baseName}
        </span>
        {showLineRange && (
          <span className="text-ov-text-secondary/70 shrink-0">
            :{offset}-{offset + limit}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative group">
      {cleanContent && <FileRenderer content={cleanContent} lang={lang} />}
    </div>
  );
}
