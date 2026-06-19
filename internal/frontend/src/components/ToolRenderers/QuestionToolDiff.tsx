import type { ToolCall } from "../../hooks/useApi";
import { useCopy } from "../../hooks/useCopy";

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

interface QuestionInput {
  questions: QuestionItem[];
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

export function QuestionToolDiff({ tool }: { tool: ToolCall }) {
  let questions: QuestionItem[] = [];
  try {
    const parsed: QuestionInput = JSON.parse(tool.input);
    questions = parsed.questions || [];
  } catch {
    /* ignore */
  }

  if (questions.length === 0) {
    const text = tool.input
      ?.replace(/^\{?"(?:question|text|prompt)":\s*"/, "")
      .replace(/"\}$/, "")
      .slice(0, 120);
    if (!text) return null;
    const simpleText = [text, tool.output].filter(Boolean).join("\n");
    return (
      <div className="overflow-hidden group">
        <div className="flex items-start gap-2 px-3 py-2">
          <span className="flex-1 text-[11px] text-gh-text">{text}</span>
          <CopyBtn text={simpleText} />
        </div>
        {tool.output && (
          <div className="border-t border-accent-border px-3 py-1.5 text-[11px] text-emerald-400">
            → {tool.output}
          </div>
        )}
      </div>
    );
  }

  const q = questions[0];

  const qaText = tool.output
    ? `Question: ${q.header || q.question}\nAnswer: ${tool.output}`
    : `Question: ${q.header || q.question}`;

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3 group">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 11.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm.75-7.25a1.75 1.75 0 0 0-1.75 1.75.75.75 0 0 0 1.5 0 .25.25 0 0 1 .5 0c0 .375-.108.555-.46.928l-.09.095C6.36 7.946 6 8.462 6 9.5a.75.75 0 0 0 1.5 0c0-.375.108-.555.46-.928l.09-.095C8.64 8.054 9 7.538 9 6.5a1.75 1.75 0 0 0-1.25-1.75Z" />
        </svg>
        <span className="font-medium text-gh-text truncate flex-1">{q.header || q.question}</span>
        <CopyBtn text={qaText} />
      </div>
      <div className="px-3 py-2">
        {q.question && q.header !== q.question && (
          <p className="text-[11px] text-gh-text mb-2">{q.question}</p>
        )}
        {q.options && q.options.length > 0 && (
          <div className="space-y-1">
            {q.options.map((opt, i) => {
              const chosen =
                tool.output &&
                (tool.output.toLowerCase().includes(opt.label.toLowerCase()) ||
                  tool.output.toLowerCase().includes(`option ${i + 1}`));
              return (
                <div
                  key={i}
                  className={`px-2.5 py-1.5 rounded text-[11px] border ${
                    chosen
                      ? "border-accent-border bg-accent-muted text-accent"
                      : "border-gh-border bg-gh-bg-secondary/30 text-gh-text-secondary"
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="ml-1 text-gh-text-secondary/70">— {opt.description}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tool.output && (
          <div className="mt-2 border-t border-accent-border pt-2 text-[11px] text-emerald-400 flex items-center gap-1">
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75Z" />
            </svg>
            <span>User answered: {tool.output}</span>
          </div>
        )}
      </div>
    </div>
  );
}
