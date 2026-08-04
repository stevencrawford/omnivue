import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { resetApp } from "../../hooks/apiClient";

export function AboutSettingsTab() {
  const [resetting, setResetting] = useState(false);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [resetConfirmText, setResetConfirmText] = useState("");

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetApp();
    } catch (err) {
      console.error("Failed to reset:", err);
    } finally {
      setResetting(false);
      setResetStep(0);
      setResetConfirmText("");
    }
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        About
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Omnivue — AI session manager for OpenCode, Copilot, Cursor, Pi, and Codex.
      </p>

      <p className="text-xs text-ov-text-secondary leading-relaxed mb-4">
        View, search, and manage all your AI coding sessions from one place. Omnivue reads agent
        session databases in read-only mode, indexes their content for full-text search, and
        displays conversations, plans, diffs, and tool calls in a unified interface. Supports
        OpenCode, GitHub Copilot, Cursor, Pi, and Codex.
      </p>

      <div className="text-xs text-ov-text-secondary space-y-1 mb-4">
        <p>
          <span className="text-ov-text">Repository:</span>{" "}
          <a
            href="https://github.com/stevencrawford/omnivue"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            github.com/stevencrawford/omnivue
          </a>
        </p>
      </div>

      <div className="border-t border-ov-border pt-4 mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-1">
          Factory Reset
        </h4>
        <p className="text-xs text-ov-text-secondary mb-3">
          Remove all Omnivue-local data including sources, tags, scratch notes, bookmarks, search
          index, and configuration. Agent data on disk is unaffected.
        </p>

        {resetStep === 0 && (
          <button
            type="button"
            onClick={() => setResetStep(1)}
            className="text-xs px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer transition-colors"
          >
            Reset Omnivue
          </button>
        )}

        {resetStep === 1 && (
          <div className="p-3 rounded-md border border-red-500/30 bg-red-500/[0.08] space-y-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="size-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400/90">
                This will permanently remove all local data: sources, tags, bookmarks, scratch
                notes, search index, and settings. Agent data on disk is safe and can be re-added.
                This action cannot be undone.
              </p>
            </div>
            <div>
              <p className="text-xs text-red-400/90 mb-1.5">
                Type <span className="font-mono font-bold">RESET</span> to confirm.
              </p>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="Type RESET"
                className="w-full text-xs bg-ov-bg border border-red-500/30 rounded-md px-2 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-red-400 font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && resetConfirmText === "RESET" && !resetting) {
                    handleReset();
                  }
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setResetStep(0);
                  setResetConfirmText("");
                }}
                className="text-xs px-2 py-1 rounded-md border border-ov-border text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={resetConfirmText !== "RESET" || resetting}
                onClick={handleReset}
                className="text-xs px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 cursor-pointer transition-colors"
              >
                {resetting ? <Loader2 className="size-3 animate-spin" /> : "Confirm Reset"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
