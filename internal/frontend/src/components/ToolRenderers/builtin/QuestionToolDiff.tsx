import { useState } from "react";
import { CircleHelp, CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

export function QuestionToolDiff({
  tool,
  compact,
  onCopy: _onCopy,
  onBookmark: _onBookmark,
  isBookmarked: _isBookmarked,
}: ToolRendererProps) {
  let questions: QuestionItem[] = [];
  try {
    const parsed = JSON.parse(tool.input);
    if ("questions" in parsed && Array.isArray(parsed.questions)) {
      questions = parsed.questions;
    } else if (
      "choices" in parsed &&
      Array.isArray(parsed.choices) &&
      "question" in parsed &&
      typeof parsed.question === "string"
    ) {
      questions = [
        {
          question: parsed.question,
          header: parsed.question,
          options: parsed.choices.map((label: string) => ({ label })),
        },
      ];
    }
  } catch {
    /* ignore */
  }

  if (questions.length === 0) {
    const text = tool.input
      ?.replace(/^\{?"(?:question|text|prompt)":\s*"/, "")
      .replace(/"\}$/, "")
      .slice(0, 120);
    if (!text) return null;

    if (compact) {
      return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
          <CircleHelp size={12} className="text-orange-400 shrink-0" />
          <span className="text-ov-text truncate min-w-0">{text}</span>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-start gap-2 px-3 py-2">
          <span className="flex-1 text-[11px] text-ov-text">{text}</span>
        </div>
        {tool.output && (
          <div className="border-t border-accent-border px-3 py-1.5 text-[11px] text-emerald-400">
            → {tool.output}
          </div>
        )}
      </>
    );
  }

  const [activeIdx, setActiveIdx] = useState(0);
  const q = questions[activeIdx] || questions[0];
  const userAnswer = tool.output || "";

  const selectedLabel = findSelectedOption(userAnswer, q.options || []);
  const freeformText = !selectedLabel ? userAnswer : null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleHelp size={12} className="text-orange-400 shrink-0" />
        <span className="text-ov-text truncate min-w-0">
          {q.header || q.question || "question"}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono text-ov-text-secondary">
        {questions.length > 1 ? (
          <div className="flex gap-1 flex-1 min-w-0 overflow-x-auto">
            {questions.map((qItem, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`shrink-0 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                  i === activeIdx
                    ? "bg-accent-muted text-accent"
                    : "text-ov-text-secondary hover:text-ov-text"
                }`}
              >
                {qItem.header || `Question ${i + 1}`}
              </button>
            ))}
          </div>
        ) : (
          <span className="font-medium text-ov-text truncate flex-1">{q.header || q.question}</span>
        )}
      </div>
      <div className="px-3 py-2">
        {q.question && q.header !== q.question && (
          <p className="text-[11px] text-ov-text mb-2">{q.question}</p>
        )}
        {q.options && q.options.length > 0 && (
          <div className="space-y-1">
            {q.options.map((opt, i) => {
              const chosen = selectedLabel === opt.label;
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] border ${
                    chosen
                      ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400"
                      : "border-ov-border bg-ov-bg-secondary/30 text-ov-text-secondary"
                  }`}
                >
                  {chosen ? (
                    <CircleCheckBig size={14} className="shrink-0 text-emerald-400" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-ov-text-secondary/70 ml-1">— {opt.description}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {freeformText && (
          <div className="mt-2 text-[11px] text-ov-text whitespace-pre-wrap leading-relaxed border-l-2 border-ov-border pl-2">
            {freeformText}
          </div>
        )}
      </div>
    </>
  );
}

function findSelectedOption(output: string, options: Array<{ label: string }>): string | null {
  if (!output || options.length === 0) return null;

  const userSelectedMatch = output.match(/^User selected:\s*(.+)/);
  if (userSelectedMatch) {
    const candidate = userSelectedMatch[1].trim();
    for (const opt of options) {
      if (candidate === opt.label || candidate.startsWith(opt.label)) {
        return opt.label;
      }
    }
    return candidate;
  }

  for (const opt of options) {
    if (
      output.toLowerCase() === opt.label.toLowerCase() ||
      output.toLowerCase().includes(opt.label.toLowerCase())
    ) {
      return opt.label;
    }
  }

  for (let i = 0; i < options.length; i++) {
    if (output.toLowerCase().includes(`option ${i + 1}`)) {
      return options[i].label;
    }
  }

  return null;
}
