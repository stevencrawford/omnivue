import type { ToolCall } from "../../hooks/useApi";

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

interface QuestionInput {
  questions: QuestionItem[];
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
    return (
      <div className="overflow-hidden">
        <div className="px-3 py-2 text-[11px] text-gh-text">{text}</div>
        {tool.output && (
          <div className="border-t border-accent-border px-3 py-1.5 text-[11px] text-emerald-400">
            → {tool.output}
          </div>
        )}
      </div>
    );
  }

  const q = questions[0];

  return (
    <div className="border border-gh-border rounded-lg bg-gh-bg-secondary/50 overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent-border bg-gh-bg-secondary/50 text-[11px] font-mono text-gh-text-secondary">
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7 11.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm.75-7.25a1.75 1.75 0 0 0-1.75 1.75.75.75 0 0 0 1.5 0 .25.25 0 0 1 .5 0c0 .375-.108.555-.46.928l-.09.095C6.36 7.946 6 8.462 6 9.5a.75.75 0 0 0 1.5 0c0-.375.108-.555.46-.928l.09-.095C8.64 8.054 9 7.538 9 6.5a1.75 1.75 0 0 0-1.25-1.75Z" />
        </svg>
        <span className="font-medium text-gh-text truncate">{q.header || q.question}</span>
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
