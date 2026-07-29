import { useMemo } from "react";
import { CircleHelp, CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../MarkdownContent";
import { ToolActionsBar } from "../ToolActionsBar";

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

export function QuestionToolDiff({
  tool,
  variant,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
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

  const parsedMeta = useMemo(() => {
    if (!tool.metadata) return null;
    try {
      return JSON.parse(tool.metadata);
    } catch {
      return null;
    }
  }, [tool.metadata]);

  const answers: string[] = useMemo(() => {
    if (!parsedMeta?.answers || !Array.isArray(parsedMeta.answers)) return [];
    return parsedMeta.answers.map((a: unknown) => {
      if (Array.isArray(a)) return a[0] ?? "";
      if (typeof a === "string") return a;
      return "";
    });
  }, [parsedMeta]);

  if (questions.length === 0) {
    const text = tool.input
      ?.replace(/^\{?"(?:question|text|prompt)":\s*"/, "")
      .replace(/"\}$/, "")
      .slice(0, 120);
    if (!text) return null;

    if (variant === "summary") {
      return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
          <CircleHelp size={12} className="text-pink-400 shrink-0" />
          <span className="text-ov-text truncate min-w-0">{text}</span>
        </div>
      );
    }

    return (
      <div className="border border-pink-500/30 rounded-lg overflow-hidden bg-pink-500/[0.03] mb-3">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <CircleHelp size={20} className="text-pink-400 shrink-0" />
            <span className="font-semibold text-[13px] text-pink-400">Question</span>
            <div className="ml-auto">
              <ToolActionsBar
                tool={tool}
                onPin={onPin}
                onBookmark={onBookmark}
                isBookmarked={isBookmarked}
                childSessionId={childSessionId}
                navigateToSession={navigateToSession}
              />
            </div>
          </div>
          <div className="mt-2 text-[13px]">
            <p className="text-ov-text-secondary leading-relaxed">{text}</p>
          </div>
          {tool.output && (
            <div className="mt-2 pt-2 border-t border-pink-500/20">
              <span className="text-[11px] text-emerald-400">→ {tool.output}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (variant === "summary") {
    const label =
      questions.length === 1
        ? questions[0].header || questions[0].question || "question"
        : `${questions.length} questions`;
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <CircleHelp size={12} className="text-pink-400 shrink-0" />
        <span className="text-ov-text truncate min-w-0">{label}</span>
      </div>
    );
  }

  return (
    <div className="border border-pink-500/30 rounded-lg overflow-hidden bg-pink-500/[0.03] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CircleHelp size={20} className="text-pink-400 shrink-0" />
          <span className="font-semibold text-[13px] text-pink-400">
            {questions.length === 1 ? "Question" : `${questions.length} Questions`}
          </span>
          <div className="ml-auto">
            <ToolActionsBar
              tool={tool}
              onPin={onPin}
              onBookmark={onBookmark}
              isBookmarked={isBookmarked}
              childSessionId={childSessionId}
              navigateToSession={navigateToSession}
            />
          </div>
        </div>
        <div className="mt-2 text-[13px] space-y-4">
          {questions.map((q, qi) => {
            const answer = answers[qi];
            const selectedLabel = q.options ? findSelectedOption(answer || "", q.options) : null;
            const freeformText = answer && !selectedLabel ? answer : null;
            return (
              <div key={qi}>
                {q.question && (
                  <div className="mb-2">
                    <MarkdownContent content={q.question} className="markdown-body--wide" />
                  </div>
                )}
                {q.options && q.options.length > 0 && (
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const chosen = selectedLabel === opt.label;
                      return (
                        <div
                          key={oi}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13px] border ${
                            chosen
                              ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-400"
                              : "border-ov-border bg-ov-bg-secondary/30 text-ov-text-secondary"
                          }`}
                        >
                          {chosen ? (
                            <CircleCheckBig size={16} className="shrink-0 text-emerald-400" />
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                          <span className="font-medium">{opt.label}</span>
                          {opt.description && (
                            <span className="text-ov-text-secondary/70 ml-1">
                              — {opt.description}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {freeformText && (
                  <div className="mt-2 pt-2 border-t border-pink-500/20">
                    <div className="text-[11px] font-semibold text-ov-text-secondary/60 uppercase tracking-wider mb-1">
                      Response
                    </div>
                    <div className="text-[13px] text-ov-text pl-2 border-l-2 border-pink-400/40 whitespace-pre-wrap leading-relaxed">
                      {freeformText}
                    </div>
                  </div>
                )}
                {qi < questions.length - 1 && <div className="h-px bg-pink-500/20 -mx-4 mt-4" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
