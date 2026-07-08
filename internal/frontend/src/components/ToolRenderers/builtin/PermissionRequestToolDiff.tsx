import { ShieldAlert, CircleCheckBig } from "lucide-react";
import type { ToolRendererProps } from "../types";
import { ToolActionsBar } from "../ToolActionsBar";

interface PermissionOption {
  label: string;
  description?: string;
}

export function PermissionRequestToolDiff({
  tool,
  variant,
  onPin,
  onBookmark,
  isBookmarked,
  childSessionId,
  navigateToSession,
}: ToolRendererProps) {
  let command = "";
  let options: PermissionOption[] = [];

  try {
    const parsed = JSON.parse(tool.input);
    command = parsed.command || "";
    if (Array.isArray(parsed.options)) {
      options = parsed.options;
    } else if (Array.isArray(parsed.choices)) {
      options = parsed.choices.map((label: string) => ({ label }));
    } else if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      const q = parsed.questions[0];
      command = q.question || q.header || "";
      if (Array.isArray(q.options)) {
        options = q.options;
      }
    }
  } catch {
    /* ignore */
  }

  if (!command && options.length === 0) {
    const text = tool.input?.slice(0, 120);
    if (!text) return null;

    if (variant === "summary") {
      return (
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
          <ShieldAlert size={12} className="text-amber-400 shrink-0" />
          <span className="text-ov-text truncate min-w-0">Permission needed</span>
        </div>
      );
    }

    return (
      <div className="border border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/[0.03] mb-3">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <ShieldAlert size={20} className="text-amber-400 shrink-0" />
            <span className="font-semibold text-[13px] text-amber-400">Permission Request</span>
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
            <div className="mt-2 pt-2 border-t border-amber-500/20">
              <span className="text-[11px] text-emerald-400">→ {tool.output}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const userAnswer = tool.output || "";
  const selectedLabel = findSelectedOption(userAnswer, options);

  if (variant === "summary") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono min-w-0">
        <ShieldAlert size={12} className="text-amber-400 shrink-0" />
        <span className="text-ov-text truncate min-w-0">
          {command.slice(0, 80) || "Permission needed"}
        </span>
      </div>
    );
  }

  return (
    <div className="border border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/[0.03] mb-3">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={20} className="text-amber-400 shrink-0" />
          <span className="font-semibold text-[13px] text-amber-400">Permission Request</span>
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
          {command && (
            <div className="mb-3">
              <p className="text-ov-text-secondary leading-relaxed whitespace-pre-wrap">
                {command}
              </p>
            </div>
          )}
          {options.length > 0 && (
            <div className="space-y-1.5">
              {options.map((opt, i) => {
                const chosen = selectedLabel === opt.label;
                return (
                  <div
                    key={i}
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
                      <span className="text-ov-text-secondary/70 ml-1">— {opt.description}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function findSelectedOption(output: string, options: PermissionOption[]): string | null {
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
