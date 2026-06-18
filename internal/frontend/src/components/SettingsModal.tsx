import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { fetchSources } from "../hooks/useApi";
import type { Source } from "../hooks/useApi";
import { useTheme } from "../hooks/useTheme";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const data = await fetchSources();
      setSources(data);
    } catch {
      setSourcesError("Failed to load sources");
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadSources();
  }, [isOpen, loadSources]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="md">
      <div className="space-y-6">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            Agent Directories
          </h3>
          {sourcesLoading ? (
            <p className="text-xs text-gh-text-secondary">Loading...</p>
          ) : sourcesError ? (
            <p className="text-xs text-red-400">{sourcesError}</p>
          ) : sources.length === 0 ? (
            <p className="text-xs text-gh-text-secondary">No sources configured.</p>
          ) : (
            <div className="space-y-1">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gh-bg-secondary border border-gh-border text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-gh-text font-mono">{source.path}</p>
                    <p className="text-[11px] text-gh-text-secondary">
                      {source.agentType} · {source.enabled ? "Enabled" : "Disabled"}
                      {source.label && ` · ${source.label}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gh-text-secondary mt-2">
            Use <code className="text-accent">sess add &lt;path&gt;</code> or{" "}
            <code className="text-accent">sess remove &lt;path&gt;</code> to manage directories.
            Full directory management will be available in a future update.
          </p>
        </div>

        <hr className="border-gh-border" />

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            Appearance
          </h3>
          <div className="flex items-center gap-3">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer capitalize transition-colors ${
                  theme === t
                    ? "border-accent-border bg-accent-muted text-accent"
                    : "border-gh-border text-gh-text-secondary hover:border-accent-border hover:text-gh-text"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <hr className="border-gh-border" />

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            About
          </h3>
          <p className="text-xs text-gh-text-secondary">
            sess — AI coding session viewer. Browse, search, and manage your AI agent sessions.
          </p>
        </div>
      </div>
    </Modal>
  );
}
