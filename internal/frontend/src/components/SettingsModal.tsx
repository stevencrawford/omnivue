import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { fetchSources, addSource, removeSource, setConfig } from "../hooks/useApi";
import type { Source } from "../hooks/useApi";
import { useTheme, THEMES } from "../hooks/useTheme";
import type { ThemeName, ThemeMode } from "../hooks/useTheme";

const AGENT_TYPES = [
  { value: "opencode", label: "OpenCode", disabled: false, defaultPath: "~/.local/share/opencode" },
  { value: "copilot", label: "Copilot", disabled: false, defaultPath: "~/.copilot" },
  { value: "claude", label: "Claude Code", disabled: true, defaultPath: "~/.claude" },
  { value: "codex", label: "Codex", disabled: false, defaultPath: "~/.codex" },
  { value: "cursor", label: "Cursor", disabled: false, defaultPath: "~/.cursor" },
  { value: "pi", label: "Pi", disabled: false, defaultPath: "~/.pi/agent/sessions" },
];

const THEME_PREVIEWS: Record<ThemeName, { light: string[]; dark: string[] }> = {
  default: {
    light: ["#fafafa", "#ffffff", "#ff9940", "#399ee6"],
    dark: ["#0b0e14", "#131721", "#ffad66", "#39bae6"],
  },
  nord: {
    light: ["#f2f4f8", "#ffffff", "#5e81ac", "#88c0d0"],
    dark: ["#2e3440", "#3b4252", "#81a1c1", "#88c0d0"],
  },
  catppuccin: {
    light: ["#eff1f5", "#ffffff", "#8839ef", "#ea76cb"],
    dark: ["#1e1e2e", "#313244", "#cba6f7", "#f5c2e7"],
  },
  "tokyo-night": {
    light: ["#d5d6db", "#ffffff", "#2e7de9", "#41a6b5"],
    dark: ["#24283b", "#2f3346", "#7aa2f7", "#73daca"],
  },
  github: {
    light: ["#ffffff", "#f6f8fa", "#0969da", "#1f883d"],
    dark: ["#0d1117", "#151b23", "#58a6ff", "#3fb950"],
  },
};

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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const { themeName, setThemeName, theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<"agent" | "appearance" | "privacy" | "about">("agent");

  const [showCostsSetting, setShowCostsSetting] = useState(() => {
    try {
      return localStorage.getItem("sess-show-costs") !== "false";
    } catch {
      return true;
    }
  });

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setSourcesError(null);
    try {
      const data = await fetchSources();
      setSources(data || []);
    } catch {
      setSourcesError("Failed to load sources");
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadSources();
      setAddingPath("");
      setAddingType("opencode");
      setConfirmingDeleteId(null);
    }
  }, [isOpen, loadSources]);

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
      setConfirmingDeleteId(null);
      await loadSources();
    } catch (err) {
      console.error("Failed to remove source:", err);
    } finally {
      setRemovingId(null);
    }
  };

  const handleThemeNameChange = async (name: ThemeName) => {
    setThemeName(name);
    try {
      await setConfig("theme-name", name);
    } catch {
      // Non-critical
    }
  };

  const handleThemeModeChange = async (mode: ThemeMode) => {
    setTheme(mode);
    try {
      await setConfig("theme-mode", mode);
    } catch {
      // Non-critical
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="lg">
      <div className="flex gap-0 h-[460px]">
        {/* Sidebar tabs */}
        <div className="w-40 shrink-0 border-r border-gh-border -ml-5 -my-5 pl-5 pt-5 sticky top-0 self-start">
          <nav className="flex flex-col gap-0.5 pr-4">
            {(["agent", "appearance", "privacy", "about"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`text-left px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  activeTab === tab
                    ? "bg-accent-muted text-accent"
                    : "text-gh-text-secondary hover:text-gh-text hover:bg-gh-bg-secondary"
                }`}
              >
                {tab === "agent" ? "Agent" : tab === "appearance" ? "Appearance" : tab === "privacy" ? "Privacy" : "About"}
              </button>
            ))}
          </nav>
        </div>

        {/* Content panel */}
        <div className="flex-1 min-w-0 pl-5 pr-5 overflow-y-auto">
          {activeTab === "agent" && (
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
                  {sources.map((source) =>
                    confirmingDeleteId === source.id ? (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-red-500/[0.08] border border-red-500/30"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-gh-text">
                            {source.agentType}
                            {source.label && ` · ${source.label}`}
                          </p>
                          <p className="truncate text-[11px] text-red-400/80">
                            Removes all information local to sess. Agent data unaffected. Confirm?
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(null)}
                          className="shrink-0 px-2 py-1 text-xs rounded-md border border-gh-border text-gh-text-secondary hover:text-gh-text cursor-pointer transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={removingId === source.id}
                          onClick={() => handleRemove(source.id)}
                          className="shrink-0 px-2 py-1 text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 cursor-pointer transition-colors"
                        >
                          {removingId === source.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Delete"
                          )}
                        </button>
                      </div>
                    ) : (
                      <div
                        key={source.id}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md bg-gh-bg-secondary border border-gh-border text-xs"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-gh-text">
                            {source.agentType}
                            {source.label && ` · ${source.label}`}
                          </p>
                          <p className="truncate text-[11px] text-gh-text-secondary font-mono">
                            {source.path}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={removingId === source.id}
                          onClick={() => setConfirmingDeleteId(source.id)}
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
                    ),
                  )}
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
                  placeholder={
                    AGENT_TYPES.find((at) => at.value === addingType)?.defaultPath ??
                    "/path/to/agent/data"
                  }
                  className="flex-1 text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text placeholder:text-gh-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px var(--color-glow)] font-mono"
                />
                <select
                  value={addingType}
                  onChange={(e) => setAddingType(e.target.value)}
                  className="text-xs bg-gh-bg border border-gh-border rounded-md px-2 py-1.5 text-gh-text outline-none focus:border-accent cursor-pointer"
                >
                  {AGENT_TYPES.map((at) => (
                    <option key={at.value} value={at.value} disabled={at.disabled}>
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
                  {adding ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                  Add
                </button>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-3">
                Appearance
              </h3>

              <p className="text-[11px] font-medium text-gh-text-secondary mb-2">Theme</p>
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((t) => {
                  const isActive = themeName === t.name;
                  const cols = THEME_PREVIEWS[t.name][theme];
                  return (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => handleThemeNameChange(t.name)}
                      className={`rounded-lg border overflow-hidden cursor-pointer transition-colors ${
                        isActive
                          ? "border-accent-border"
                          : "border-gh-border hover:border-gh-text-secondary"
                      }`}
                    >
                      <div className="flex flex-col">
                        {cols.map((c, i) => (
                          <div
                            key={i}
                            className="w-full"
                            style={{
                              backgroundColor: c,
                              height: i < 2 ? 12 : 8,
                            }}
                          />
                        ))}
                      </div>
                      <div
                        className={`px-2.5 py-1.5 text-xs text-left ${
                          isActive
                            ? "bg-accent-muted text-gh-text font-medium"
                            : "bg-gh-bg-secondary text-gh-text-secondary"
                        }`}
                      >
                        {t.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] font-medium text-gh-text-secondary mt-3 mb-2">Mode</p>
              <div className="flex items-center gap-3">
                {(["light", "dark"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleThemeModeChange(m)}
                    className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer capitalize transition-colors ${
                      theme === m
                        ? "border-accent-border bg-accent-muted text-accent"
                        : "border-gh-border text-gh-text-secondary hover:border-accent-border hover:text-gh-text"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "privacy" && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
                Privacy
              </h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCostsSetting}
                  onChange={(e) => {
                    setShowCostsSetting(e.target.checked);
                    try {
                      localStorage.setItem("sess-show-costs", e.target.checked ? "true" : "false");
                    } catch {
                      /* noop */
                    }
                  }}
                  className="accent-accent"
                />
                <span className="text-xs text-gh-text">Show costs</span>
              </label>
            </div>
          )}

          {activeTab === "about" && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gh-text-secondary mb-2">
                About
              </h3>
              <p className="text-xs text-gh-text-secondary">
                sess — AI coding session viewer. Browse, search, and manage your AI agent sessions.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
