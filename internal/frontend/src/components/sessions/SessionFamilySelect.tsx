import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { SessionFamilyMember } from "../../utils/sessionFamily";

interface SessionFamilySelectProps {
  /** Root session ("Main") plus every sub-agent, in display order. */
  family: SessionFamilyMember[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
}

/**
 * Header control for switching between a session's main view and its
 * sub-agents. The trigger names the current member, so the dropdown doubles as
 * a position indicator while the user navigates the family in place. Renders
 * nothing when the session has no sub-agents, so the title row is unchanged for
 * the common case.
 */
export function SessionFamilySelect({ family, activeId, onSelect }: SessionFamilySelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Only meaningful when at least one sub-agent exists.
  if (family.length <= 1) return null;

  const activeMember = family.find((m) => m.session.id === activeId) ?? family[0];

  const handleSelect = (id: string) => {
    setOpen(false);
    if (id !== activeId) onSelect(id);
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 max-w-[16rem] px-1.5 py-0.5 rounded-md border border-ov-border bg-ov-bg-secondary text-xs text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
        title="Switch between the main session and its sub-agents"
        aria-label={`Session family: ${activeMember.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{activeMember.label}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-ov-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Session family"
          className="absolute left-0 top-full mt-1 min-w-full max-w-[20rem] bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-30 py-1 max-h-72 overflow-y-auto"
        >
          {family.map((member) => {
            const isCurrent = member.session.id === activeId;
            return (
              <button
                key={member.session.id}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => handleSelect(member.session.id)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
                  isCurrent
                    ? "text-ov-text bg-ov-bg-active"
                    : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
                }`}
              >
                <span className="w-3 shrink-0">
                  {isCurrent && <Check size={12} className="text-accent" />}
                </span>
                <span className="truncate flex-1">{member.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
