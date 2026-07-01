import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Plus, Loader2, TriangleAlert } from "lucide-react";
import { fetchSources, addSource, removeSource, setConfig, resetApp } from "../hooks/useApi";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import type { Source } from "../hooks/useApi";
import { useTheme, THEMES } from "../hooks/useTheme";
import type { ThemeName, ThemeMode } from "../hooks/useTheme";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Separator } from "./ui/separator";

const AGENT_TYPES = [
  { value: "opencode", label: "OpenCode", disabled: false, defaultPath: "~/.local/share/opencode" },
  { value: "copilot", label: "Copilot", disabled: false, defaultPath: "~/.copilot" },
  { value: "claude-code", label: "Claude Code", disabled: false, defaultPath: "~/.claude" },
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
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  const { themeName, setThemeName, theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<
    "agent" | "appearance" | "privacy" | "developer" | "about"
  >("agent");

  const [hideCostsSetting, setHideCostsSetting] = useState(() => {
    try {
      return localStorage.getItem("omnivue-hide-costs") === "true";
    } catch {
      return false;
    }
  });

  const [disableCustomRenderers, setDisableCustomRenderers] = useState(() => {
    try {
      return localStorage.getItem("omnivue-disable-custom-renderers") === "true";
    } catch {
      return false;
    }
  });

  const [resetting, setResetting] = useState(false);
  const [resetStep, setResetStep] = useState<0 | 1>(0);
  const [resetConfirmText, setResetConfirmText] = useState("");

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
      setAgentFilter(null);
      setResetStep(0);
      setResetConfirmText("");
    }
  }, [isOpen, loadSources]);

  const agentTypes = useMemo(() => {
    const types = new Set(sources.map((s) => s.agentType));
    return Array.from(types).sort();
  }, [sources]);

  const filteredSources = useMemo(() => {
    if (!agentFilter) return sources;
    return sources.filter((s) => s.agentType === agentFilter);
  }, [sources, agentFilter]);

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

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetApp();
    } catch (err) {
      console.error("Failed to reset:", err);
      setResetting(false);
      setResetStep(0);
      setResetConfirmText("");
    }
  };

  const handleResetClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) handleResetClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex gap-0 h-[460px]">
          {/* Sidebar tabs */}
          <div className="w-40 shrink-0 border-r border-ov-border -ml-6 -my-6 pl-6 pt-6 sticky top-0 self-start">
            <nav className="flex flex-col gap-0.5 pr-4">
              {(["agent", "appearance", "privacy", "developer", "about"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`text-left px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    activeTab === tab
                      ? "bg-accent-muted text-accent"
                      : "text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-secondary"
                  }`}
                >
                  {tab === "agent"
                    ? "Agent"
                    : tab === "appearance"
                      ? "Appearance"
                      : tab === "privacy"
                        ? "Privacy"
                        : tab === "developer"
                          ? "Developer"
                          : "About"}
                </button>
              ))}
            </nav>
          </div>

          {/* Content panel */}
          <div className="flex-1 min-w-0 pl-5 pr-5 overflow-y-auto">
            {activeTab === "agent" && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                  Agent Directories
                </h3>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Add or remove agent data directories. Omnivue reads from these paths to discover
                  sessions.
                </p>

                {sourcesLoading ? (
                  <p className="text-xs text-ov-text-secondary">Loading...</p>
                ) : sourcesError ? (
                  <p className="text-xs text-red-400">{sourcesError}</p>
                ) : (
                  <>
                    {/* Agent type filter */}
                    {agentTypes.length > 1 && (
                      <div className="flex items-center gap-1 mb-2 flex-wrap">
                        <FilterChip
                          label="Type"
                          value={agentFilter}
                          options={agentTypes}
                          onChange={setAgentFilter}
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      {filteredSources.map((source) =>
                        confirmingDeleteId === source.id ? (
                          <div
                            key={source.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-red-500/[0.08] border border-red-500/30"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-ov-text">
                                {source.agentType}
                                {source.label && ` · ${source.label}`}
                              </p>
                              <p className="truncate text-[11px] text-red-400/80">
                                Removes all information local to Omnivue. Agent data unaffected.
                                Confirm?
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="destructive"
                              size="xs"
                              disabled={removingId === source.id}
                              onClick={() => handleRemove(source.id)}
                            >
                              {removingId === source.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                "Delete"
                              )}
                            </Button>
                          </div>
                        ) : (
                          <div
                            key={source.id}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded-md bg-ov-bg-secondary border border-ov-border text-xs"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-ov-text">
                                {source.agentType}
                                {source.label && ` · ${source.label}`}
                              </p>
                              <p className="truncate text-[11px] text-ov-text-secondary font-mono">
                                {source.path}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={removingId === source.id}
                              onClick={() => setConfirmingDeleteId(source.id)}
                              className="text-ov-text-secondary hover:text-red-400"
                              title="Remove source"
                            >
                              {removingId === source.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Trash2 />
                              )}
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  </>
                )}

                {sources.length === 0 && !sourcesLoading && (
                  <p className="text-xs text-ov-text-secondary mb-2">No sources configured.</p>
                )}

                {/* Add source form */}
                <div className="flex items-center gap-2 mt-2">
                  <Input
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
                    className="flex-1 h-auto text-xs px-2 py-1.5 font-mono"
                  />
                  <select
                    value={addingType}
                    onChange={(e) => setAddingType(e.target.value)}
                    className="text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 text-ov-text outline-none focus:border-accent cursor-pointer"
                  >
                    {AGENT_TYPES.map((at) => (
                      <option key={at.value} value={at.value} disabled={at.disabled}>
                        {at.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={!addingPath.trim() || adding}
                    onClick={handleAdd}
                  >
                    {adding ? <Loader2 className="animate-spin" /> : <Plus />}
                    Add
                  </Button>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                  Appearance
                </h3>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Customize the look and feel of your Omnivue interface.
                </p>

                <p className="text-[11px] font-medium text-ov-text-secondary mb-2">Theme</p>
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
                            : "border-ov-border hover:border-ov-text-secondary"
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
                              ? "bg-accent-muted text-ov-text font-medium"
                              : "bg-ov-bg-secondary text-ov-text-secondary"
                          }`}
                        >
                          {t.label}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-[11px] font-medium text-ov-text-secondary mt-3 mb-2">Mode</p>
                <div className="flex items-center gap-3">
                  {(["light", "dark"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleThemeModeChange(m)}
                      className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer capitalize transition-colors ${
                        theme === m
                          ? "border-accent-border bg-accent-muted text-accent"
                          : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
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
                <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                  Privacy
                </h3>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Control what data is displayed in the UI.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideCostsSetting}
                    onChange={(e) => {
                      setHideCostsSetting(e.target.checked);
                      try {
                        localStorage.setItem(
                          "omnivue-hide-costs",
                          e.target.checked ? "true" : "false",
                        );
                      } catch {
                        /* noop */
                      }
                    }}
                    className="accent-accent"
                  />
                  <span className="text-xs text-ov-text">Hide costs</span>
                </label>
              </div>
            )}

            {activeTab === "developer" && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                  Developer
                </h3>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Tools for debugging and contributing to Omnivue.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disableCustomRenderers}
                    onChange={(e) => {
                      setDisableCustomRenderers(e.target.checked);
                      try {
                        localStorage.setItem(
                          "omnivue-disable-custom-renderers",
                          e.target.checked ? "true" : "false",
                        );
                      } catch {
                        /* noop */
                      }
                    }}
                    className="accent-accent"
                  />
                  <span className="text-xs text-ov-text">Disable custom tool call renderers</span>
                </label>
                <p className="text-[11px] text-ov-text-secondary mt-1 ml-5">
                  Display all tool calls using the default input/output view for debugging.
                </p>
              </div>
            )}

            {activeTab === "about" && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                  About
                </h3>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Omnivue — AI session manager for OpenCode, Copilot, Cursor, Pi, and Codex.
                </p>

                <p className="text-xs text-ov-text-secondary leading-relaxed mb-4">
                  Browse, search, and manage all your AI coding sessions from one place. Omnivue
                  reads agent session databases in read-only mode, indexes their content for
                  full-text search, and displays conversations, plans, diffs, and tool calls in a
                  unified browser UI. Supports OpenCode, GitHub Copilot, Cursor, Pi, and Codex.
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

                <Separator className="my-4" />
                {/* Factory Reset */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-1">
                    Factory Reset
                  </h4>
                  <p className="text-xs text-ov-text-secondary mb-3">
                    Remove all Omnivue-local data including sources, folders, scratch notes,
                    bookmarks, search index, and configuration. Agent data on disk is unaffected.
                  </p>

                  {resetStep === 0 && (
                    <Button variant="destructive" size="xs" onClick={() => setResetStep(1)}>
                      Reset Omnivue
                    </Button>
                  )}

                  {resetStep === 1 && (
                    <div className="p-3 rounded-md border border-red-500/30 bg-red-500/[0.08] space-y-3">
                      <div className="flex items-start gap-2">
                        <TriangleAlert className="size-4 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-400/90">
                          This will permanently remove all local data: sources, folders, bookmarks,
                          scratch notes, search index, and settings. Agent data on disk is safe and
                          can be re-added. This action cannot be undone.
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-red-400/90 mb-1.5">
                          Type <span className="font-mono font-bold">RESET</span> to confirm.
                        </p>
                        <Input
                          type="text"
                          value={resetConfirmText}
                          onChange={(e) => setResetConfirmText(e.target.value)}
                          placeholder="Type RESET"
                          className="w-full h-auto text-xs px-2 py-1.5 font-mono border-red-500/30 focus-visible:border-red-400"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && resetConfirmText === "RESET" && !resetting) {
                              handleReset();
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            setResetStep(0);
                            setResetConfirmText("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="xs"
                          disabled={resetConfirmText !== "RESET" || resetting}
                          onClick={handleReset}
                        >
                          {resetting ? <Loader2 className="animate-spin" /> : "Confirm Reset"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────

function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const displayLabel = value ?? `All ${label}s`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`text-[11px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
          value
            ? "border-accent-border bg-accent-muted text-accent"
            : "border-ov-border text-ov-text-secondary hover:border-accent-border hover:text-ov-text"
        }`}
      >
        {label}: {displayLabel}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-surface-elevated border border-ov-border rounded-lg shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
          <button
            type="button"
            className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors ${
              !value
                ? "text-ov-text bg-ov-bg-active"
                : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
            }`}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            All {label}s
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`w-full text-left px-3 py-1 text-xs cursor-pointer transition-colors truncate capitalize ${
                value === opt
                  ? "text-ov-text bg-ov-bg-active"
                  : "text-ov-text-secondary hover:bg-ov-bg-hover hover:text-ov-text"
              }`}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
