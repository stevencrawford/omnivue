import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import {
  fetchSources,
  addSource,
  removeSource,
  fetchConfig,
  setConfig,
} from "../hooks/useApi";
import type { Source } from "../hooks/useApi";
import { useTheme } from "../hooks/useTheme";

type SortMode = "recent" | "name" | "agent";

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recent",
  name: "Name",
  agent: "Agent",
};

const AGENT_TYPES = [
  { value: "opencode", label: "OpenCode" },
  { value: "copilot", label: "Copilot" },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [addingPath, setAddingPath] = useState("");
  const [addingType, setAddingType] = useState("opencode");
  const [adding, setAdding] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const { theme, setTheme } = useTheme();
  const [defaultSort, setDefaultSort] = useState<SortMode>("recent");
  const [savingSort, setSavingSort] = useState(false);

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

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await fetchConfig();
      if (cfg.defaultSort === "name" || cfg.defaultSort === "agent") {
        setDefaultSort(cfg.defaultSort as SortMode);
      }
    } catch {
      // Config loading is non-critical
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSources();
      loadConfig();
      setAddingPath("");
      setAddingType("opencode");
    }
  }, [isOpen, loadSources, loadConfig]);

  const handleAdd = async () => {
    const path = addingPath.trim();
    if (!path) return;
    setAdding(true);
    try {
      await addSource(path, addingType);
      setAddingPath("");
      await loadSources();
    } catch (err) {
      console.error("Failed to add source:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeSource(id);
      await loadSources();
    } catch (err) {
      console.error("Failed to remove source:", err);
    } finally {
      setRemovingId(null);
    }
  };

  const handleThemeChange = async (t: "light" | "dark") => {
    setTheme(t);
    try {
      await setConfig("theme", t);
    } catch {
      // Non-critical
    }
  };

  const handleSortChange = async (mode: SortMode) => {
    setDefaultSort(mode);
    setSavingSort(true);
    try {
      await setConfig("defaultSort", mode);
    } catch {
      // Non-critical
    } finally {
      setSavingSort(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="md">
      <div className="space-y-6">
        {/* Agent Directories */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            Agent Directories
          </h3>

          {sourcesLoading ? (
            <p className="text-xs text-gh-text-secondary">Loading...</p>
          ) : sourcesError ? (
            <p className="text-xs text-red-400">{sourcesError}</p>
          ) : (
            <div className="space-y-1">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-md bg-gh-bg-secondary border border-gh-border text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-gh-text font-mono">{source.path}</p>
                    <p className="text-[11px] text-gh-text-secondary">
                      {source.agentType}
                      {source.label && ` · ${source.label}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={removingId === source.id}
                    onClick={() => handleRemove(source.id)}
                    className="shrink-0 p-1 text-gh-text-secondary hover:text-red-400 disabled:opacity-40 cursor-pointer transition-colors"
                    title="Remove source"
                  >
                    {removingId === source.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {sources.length === 0 && !sourcesLoading && (
            <p className="text-xs text-gh-text-secondary mb-2">No sources configured.</p>
          )}

          {/* Add source form */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={addingPath}
              onChange={(e) => setAddingPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="/path/to/agent/data"
              className="flex-1 text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)] font-mono"
            />
            <select
              value={addingType}
              onChange={(e) => setAddingType(e.target.value)}
              className="text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text outline-none focus:border-accent cursor-pointer"
            >
              {AGENT_TYPES.map((at) => (
                <option key={at.value} value={at.value}>
                  {at.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addingPath.trim() || adding}
              onClick={handleAdd}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent-border bg-accent-muted text-accent hover:bg-accent/20"
            >
              {adding ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Add
            </button>
          </div>
        </div>

        <hr className="border-gh-border" />

        {/* Appearance */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            Appearance
          </h3>
          <div className="flex items-center gap-3">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleThemeChange(t)}
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

        {/* Default Sort */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
            Default Session Sort
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={defaultSort}
              onChange={(e) => handleSortChange(e.target.value as SortMode)}
              className="text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text outline-none focus:border-accent cursor-pointer"
            >
              {(["recent", "name", "agent"] as SortMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {SORT_LABELS[mode]}
                </option>
              ))}
            </select>
            {savingSort && <Loader2 className="size-3 text-gh-text-secondary animate-spin" />}
          </div>
        </div>

        <hr className="border-gh-border" />

        {/* About */}
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
