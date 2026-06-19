import type { ToolCall } from "../../hooks/useApi";
import { useCopy } from "../../hooks/useCopy";

interface DeleteInput {
  filePath?: string;
  relativeWorkspacePath?: string;
  path?: string;
}

function CopyBtn({ text }: { text: string }) {
  const { copied, copy } = useCopy(1500);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        copy(text);
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity size-6 flex items-center justify-center rounded text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-hover cursor-pointer border border-gh-border bg-surface-elevated shrink-0"
      title="Copy"
    >
      {copied ? (
        <svg className="size-3 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 2.75C1 1.784 1.784 1 2.75 1h6.5c.966 0 1.75.784 1.75 1.75v1.5h1.5c.966 0 1.75.784 1.75 1.75v7.25c0 .966-.784 1.75-1.75 1.75h-6.5A1.75 1.75 0 0 1 4.25 13.25v-1.5h-1.5A1.75 1.75 0 0 1 1 10V2.75Zm8.5 0a.25.25 0 0 0-.25-.25h-6.5a.25.25 0 0 0-.25.25V10c0 .138.112.25.25.25h1.5V5.75c0-.966.784-1.75 1.75-1.75h3.5V2.75Zm-3 3a.25.25 0 0 0-.25.25v7.25c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V5.75a.25.25 0 0 0-.25-.25h-6.5Z" />
        </svg>
      )}
    </button>
  );
}

export function DeleteToolDiff({ tool }: { tool: ToolCall }) {
  let input: DeleteInput = {};
  try {
    input = JSON.parse(tool.input);
  } catch {
    /* ignore */
  }

  const filePath = input.filePath || input.relativeWorkspacePath || input.path || "";
  const baseName = filePath.split("/").pop() || filePath;

  return (
    <div className="border border-red-500/30 rounded-lg overflow-hidden mb-3 bg-red-500/[0.03] group">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
        <svg className="size-3.5 text-red-400 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4h12M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4M4 4v9.5A1.5 1.5 0 0 0 5.5 15h5A1.5 1.5 0 0 0 12 13.5V4" />
        </svg>
        <span className="text-red-400 font-semibold shrink-0">delete:</span>
        <span className="text-gh-text truncate">{baseName}</span>
        <span className="text-gh-text-secondary/60 truncate flex-1 min-w-0" title={filePath}>
          {filePath}
        </span>
        <CopyBtn text={filePath} />
      </div>
    </div>
  );
}
