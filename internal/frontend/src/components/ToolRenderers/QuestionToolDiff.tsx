import { CircleHelp, File } from "lucide-react";
import type { ToolCall } from "../../hooks/useApi";
import { CopyButton } from "../CopyButton";

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
    const simpleText = [text, tool.output].filter(Boolean).join("\n");
    return (
      <div className="overflow-hidden group">
        <div className="flex items-start gap-2 px-3 py-2">
          <span className="flex-1 text-[11px] text-gh-text">{text}</span>
          <CopyButton text={simpleText} />
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
        <CircleHelp size={14} className="shrink-0" />
        <span className="font-medium text-gh-text truncate flex-1">{q.header || q.question}</span>
        <CopyButton text={qaText} />
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
            <File size={12} />
            <span>User answered: {tool.output}</span>
          </div>
        )}
      </div>
    </div>
  );
}
