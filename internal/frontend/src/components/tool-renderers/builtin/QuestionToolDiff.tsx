import { useMemo, useState } from "react";
import { CircleHelp, CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { MarkdownContent } from "../../ui/MarkdownContent";
import { CopyButton } from "../../ui/CopyButton";
import { ToolActionsBar } from "../ToolActionsBar";

interface QuestionItem {
  question: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
}

interface SchemaChoice {
  const?: unknown;
  title?: string;
  description?: string;
}

interface SchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  oneOf?: SchemaChoice[];
  anyOf?: SchemaChoice[];
}

function stringifySchemaValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function schemaOptions(prop: SchemaProperty): Array<{ label: string; description?: string }> {
  const choices = prop.oneOf?.length ? prop.oneOf : prop.anyOf;
  if (choices?.length) {
    return choices.map((c) => {
      const value = stringifySchemaValue(c.const);
      const label = c.title || value;
      let description = c.description || "";
      if (value && value !== label) {
        description = description ? `${value} — ${description}` : value;
      }
      return description ? { label, description } : { label };
    });
  }
  if (prop.enum?.length) {
    return prop.enum
      .map((v) => stringifySchemaValue(v))
      .filter((s) => s !== "")
      .map((label) => ({ label }));
  }
  if (prop.type === "boolean") {
    return [{ label: "Yes" }, { label: "No" }];
  }
  return [];
}

// requestedSchemaQuestions maps Copilot's {message, requestedSchema} input
// shape to question tabs (one per schema property), mirroring the backend
// normalization so raw inputs render even before normalization.
function requestedSchemaQuestions(parsed: {
  message?: unknown;
  requestedSchema?: { properties?: Record<string, SchemaProperty> };
}): QuestionItem[] | null {
  if (typeof parsed.message !== "string" || !parsed.message) return null;
  const properties = parsed.requestedSchema?.properties;
  if (!properties || typeof properties !== "object") return null;
  const keys = Object.keys(properties).sort();
  if (keys.length === 0) return null;
  return keys.map((key, i) => {
    const prop = properties[key] ?? {};
    const header = prop.title || key;
    const prompt = prop.description || prop.title || key;
    return {
      question: i === 0 ? `${parsed.message}\n\n---\n\n**${prompt}**` : prompt,
      header,
      options: schemaOptions(prop),
    };
  });
}

function parseQuestions(input: string): QuestionItem[] {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      if ("questions" in parsed && Array.isArray(parsed.questions)) {
        return parsed.questions;
      }
      if (
        "choices" in parsed &&
        Array.isArray(parsed.choices) &&
        "question" in parsed &&
        typeof parsed.question === "string"
      ) {
        return [
          {
            question: parsed.question,
            header: parsed.question,
            options: parsed.choices.map((label: string) => ({ label })),
          },
        ];
      }
      const schemaQuestions = requestedSchemaQuestions(parsed);
      if (schemaQuestions) return schemaQuestions;
    }
  } catch {
    /* ignore */
  }
  return [];
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
  const questions: QuestionItem[] = parseQuestions(tool.input);

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
          <span className="text-ov-text-secondary/70 shrink-0">question:</span>
          <span className="text-ov-text truncate min-w-0">{text}</span>
        </div>
      );
    }

    return (
      <div className="border border-pink-500/30 rounded-lg overflow-hidden bg-pink-500/[0.03] mb-3">
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            <CircleHelp size={12} className="text-pink-400 shrink-0" />
            <span className="font-mono font-semibold text-[11px] text-pink-400">Question</span>
            <div className="ml-auto">
              <ToolActionsBar
                tool={tool}
                onPin={onPin}
                onBookmark={onBookmark}
                isBookmarked={isBookmarked}
                childSessionId={childSessionId}
                navigateToSession={navigateToSession}
                showCopy={false}
              />
            </div>
          </div>
          <div className="mt-2 text-[12px] group relative">
            <p className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">{text}</p>
            <CopyButton text={text} className="absolute top-0 right-0" />
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
        <span className="text-ov-text-secondary/70 shrink-0">question:</span>
        <span className="text-ov-text truncate min-w-0">{label}</span>
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState(0);
  const showTabs = questions.length > 1;

  if (showTabs && activeTab >= questions.length) {
    setActiveTab(0);
  }

  const activeIdx = showTabs ? Math.min(activeTab, questions.length - 1) : 0;
  const activeQ = questions[activeIdx];
  const activeAnswer = answers[activeIdx];
  // tool.output is a match-only fallback: Copilot answers arrive as tool
  // output (e.g. {"scope":"carpool_only"}) rather than metadata answers.
  // It never renders as freeform text, it only highlights the chosen option.
  const activeSelectedLabel = activeQ.options
    ? (findSelectedOption(activeAnswer || "", activeQ.options) ??
      findSelectedOption(tool.output || "", activeQ.options))
    : null;
  const activeFreeformText = activeAnswer && !activeSelectedLabel ? activeAnswer : null;

  return (
    <div className="border border-pink-500/30 rounded-lg overflow-hidden bg-pink-500/[0.03] mb-3">
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <CircleHelp size={12} className="text-pink-400 shrink-0" />
          <span className="font-mono font-semibold text-[11px] text-pink-400">
            {showTabs ? "Questions" : "Question"}
          </span>
          <div className="ml-auto">
            <ToolActionsBar
              tool={tool}
              onPin={onPin}
              onBookmark={onBookmark}
              isBookmarked={isBookmarked}
              childSessionId={childSessionId}
              navigateToSession={navigateToSession}
              showCopy={false}
            />
          </div>
        </div>

        {showTabs && (
          <div className="flex items-center gap-1 -mx-1 mt-2 mb-2 overflow-x-auto scrollbar-none">
            {questions.map((q, qi) => {
              const isActive = qi === activeIdx;
              const label = q.header || q.question || `#${qi + 1}`;
              return (
                <button
                  key={qi}
                  type="button"
                  onClick={() => setActiveTab(qi)}
                  className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? "bg-pink-500/15 text-pink-400 border border-pink-500/40"
                      : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover border border-transparent"
                  }`}
                >
                  {label}
                  {answers[qi] && <span className="ml-1.5 text-emerald-400">&#x2713;</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-1 text-[12px]">
          {activeQ.question && (
            <div className={`${showTabs ? "" : "mb-2"}`}>
              <MarkdownContent content={activeQ.question} className="markdown-body--wide" />
            </div>
          )}
          {activeQ.options && activeQ.options.length > 0 && (
            <div className="space-y-1">
              {activeQ.options.map((opt, oi) => {
                const chosen = activeSelectedLabel === opt.label;
                return (
                  <div
                    key={oi}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] border ${
                      chosen
                        ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-400"
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
          {activeFreeformText && (
            <div className="mt-2 pt-2 border-t border-pink-500/20 group relative">
              <div className="text-[11px] font-semibold text-ov-text-secondary/60 uppercase tracking-wider mb-1">
                Response
              </div>
              <div className="text-[11px] text-ov-text pl-2 border-l-2 border-pink-400/40 whitespace-pre-wrap leading-relaxed">
                {activeFreeformText}
              </div>
              <CopyButton text={activeFreeformText} className="absolute top-2 right-0" />
            </div>
          )}
          {!showTabs && !activeQ.question && !activeQ.options?.length && tool.output && (
            <div className="mt-2 pt-2 border-t border-pink-500/20">
              <span className="text-[11px] text-emerald-400">→ {tool.output}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function scalarCandidates(output: string): string[] {
  const candidates = [output];
  try {
    const collect = (value: unknown) => {
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        candidates.push(String(value));
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(collect);
      }
    };
    collect(JSON.parse(output));
  } catch {
    /* not JSON — match against the raw output only */
  }
  return candidates;
}

function valuesMatch(candidate: string, label: string): boolean {
  const c = candidate.trim().toLowerCase();
  const l = label.trim().toLowerCase();
  if (!c || !l) return false;
  if (c === l || c.includes(l)) return true;
  // Boolean answers arrive as raw JSON values while options read Yes/No.
  const booleans: Record<string, string> = { true: "yes", yes: "yes", false: "no", no: "no" };
  return booleans[c] !== undefined && booleans[c] === booleans[l];
}

function findSelectedOption(
  output: string,
  options: Array<{ label: string; description?: string }>,
): string | null {
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

  const candidates = scalarCandidates(output);
  for (const candidate of candidates) {
    for (const opt of options) {
      if (valuesMatch(candidate, opt.label)) {
        return opt.label;
      }
    }
  }

  // Descriptions carry raw const values (e.g. carpool_only) for
  // requestedSchema options; match answers against them exactly.
  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized) continue;
    for (const opt of options) {
      const description = opt.description?.trim().toLowerCase() ?? "";
      if (!description) continue;
      if (normalized === description || normalized === description.split(" — ")[0].trim()) {
        return opt.label;
      }
    }
  }

  for (let i = 0; i < options.length; i++) {
    if (output.toLowerCase().includes(`option ${i + 1}`)) {
      return options[i].label;
    }
  }

  return null;
}
