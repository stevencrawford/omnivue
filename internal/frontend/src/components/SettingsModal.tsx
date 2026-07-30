import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Plus, Loader2, TriangleAlert, Cloud, Check, Eye, EyeOff } from "lucide-react";
import { Effect } from "effect";
import { Modal } from "./Modal";
import type { Source, DiscoveredSource, NotificationSettings } from "../hooks/types";
import { SourceService, ConfigService } from "../services";
import { runPromise } from "../lib/effect";
import { useTheme, THEMES } from "../hooks/useTheme";
import type { ThemeName, ThemeMode } from "../hooks/useTheme";
import { NotificationsSettingsTab } from "./NotificationsSettingsTab";

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
  "one-monokai": {
    light: ["#f8f9fa", "#ffffff", "#e53b50", "#78dce8"],
    dark: ["#2d2d2d", "#363636", "#ff6188", "#a9dc76"],
  },
  "atom-one": {
    light: ["#fafafa", "#ffffff", "#4078f2", "#50a14f"],
    dark: ["#282c34", "#21252b", "#61afef", "#98c379"],
  },
  dracula: {
    light: ["#f8f8f2", "#ffffff", "#ff79c6", "#8be9fd"],
    dark: ["#282a36", "#21222c", "#ff79c6", "#8be9fd"],
  },
  "night-owl": {
    light: ["#fbfbfb", "#ffffff", "#0c6e9d", "#4f7e65"],
    dark: ["#011627", "#0b1e2e", "#82aaff", "#7fdbca"],
  },
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notificationSettings?: NotificationSettings | null;
  onSaveNotificationSettings?: (s: NotificationSettings) => void;
}

interface PendingSource {
  id: string;
  path: string;
  agentType: string;
  status: "loading" | "error";
  error?: string;
}

export function SettingsModal({
  isOpen,
  onClose,
  notificationSettings,
  onSaveNotificationSettings,
}: SettingsModalProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [addingPath, setAddingPath] = useState("");
  const [addingType, setAddingType] = useState("opencode");
  const [pendingSources, setPendingSources] = useState<PendingSource[]>([]);

  const [discoveredSources, setDiscoveredSources] = useState<DiscoveredSource[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const discoveredRef = useRef(false);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  // GitHub Cloud state
  const [githubToken, setGithubToken] = useState("");
  const [savedToken, setSavedToken] = useState("");
  const [githubStatus, setGithubStatus] = useState<"idle" | "verifying" | "connected" | "error">(
    "idle",
  );
  const [githubMessage, setGithubMessage] = useState("");
  const [showToken, setShowToken] = useState(false);

  const { themeName, setThemeName, theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<
    "agent" | "github" | "notifications" | "appearance" | "privacy" | "developer" | "about"
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

  const loadSources = useCallback(async (opts?: { skipDiscover?: boolean }) => {
    setSourcesLoading(true);
    setSourcesError(null);
    const data = await runPromise(
      SourceService.pipe(
        Effect.flatMap((svc) => svc.list()),
        Effect.catchAll(() => {
          setSourcesError("Failed to load sources");
          return Effect.succeed([] as Source[]);
        }),
      ),
    );
    const srcs = data || [];
    setSources(srcs);
    setSourcesLoading(false);

    // Auto-discover potential sources only when none are configured
    // and we haven't already discovered this session.
    if (srcs.length === 0 && !opts?.skipDiscover && !discoveredRef.current) {
      discoveredRef.current = true;
      setDiscovering(true);
      const discovered = await runPromise(
        SourceService.pipe(
          Effect.flatMap((svc) => svc.discover()),
          Effect.catchAll(() => Effect.succeed([] as DiscoveredSource[])),
        ),
      );
      setDiscoveredSources(discovered || []);
      setDiscovering(false);
    }
  }, []);

  const loadGithubToken = useCallback(async () => {
    try {
      const cfg = await runPromise(ConfigService.pipe(Effect.flatMap((svc) => svc.fetch())));
      const token = cfg["github-token"] || "";
      setSavedToken(token);
      setGithubToken(token);
      setGithubStatus(token ? "connected" : "idle");
      if (token) setGithubMessage("Connected");
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setActiveTab("agent");
      loadSources();
      loadGithubToken();
      setAddingPath("");
      setAddingType("opencode");
      setConfirmingDeleteId(null);
      setAgentFilter(null);
      setResetStep(0);
      setResetConfirmText("");
      setPendingSources((prev) => prev.filter((p) => p.status === "loading"));
    }
  }, [isOpen, loadSources, loadGithubToken]);

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
    const agentType = addingType;
    const pendingId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Optimistically render a loading row; keep the Add button enabled.
    setPendingSources((prev) => [...prev, { id: pendingId, path, agentType, status: "loading" }]);
    setAddingPath("");
    try {
      await runPromise(
        SourceService.pipe(
          Effect.flatMap((svc) => svc.add(path, agentType)),
          Effect.catchAll((err) => Effect.fail(err)),
        ),
      );
      // Remove any suggested source that matches the manually added path
      setDiscoveredSources((prev) => prev.filter((s) => s.path !== path));
      await loadSources();
      setPendingSources((prev) => prev.filter((p) => p.id !== pendingId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPendingSources((prev) =>
        prev.map((p) => (p.id === pendingId ? { ...p, status: "error", error: msg } : p)),
      );
    }
  };

  const handleAddDiscovered = async (d: DiscoveredSource) => {
    const pendingId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingSources((prev) => [
      ...prev,
      { id: pendingId, path: d.path, agentType: d.agentType, status: "loading" },
    ]);
    setDiscoveredSources((prev) => prev.filter((s) => s.path !== d.path));
    try {
      await runPromise(
        SourceService.pipe(
          Effect.flatMap((svc) => svc.add(d.path, d.agentType)),
          Effect.catchAll((err) => Effect.fail(err)),
        ),
      );
      await loadSources();
      setPendingSources((prev) => prev.filter((p) => p.id !== pendingId));
    } catch (err) {
      // Re-add to discovered on failure so the user can retry
      setDiscoveredSources((prev) => [...prev, d]);
      const msg = err instanceof Error ? err.message : String(err);
      setPendingSources((prev) =>
        prev.map((p) => (p.id === pendingId ? { ...p, status: "error", error: msg } : p)),
      );
    }
  };

  const dismissPending = (id: string) =>
    setPendingSources((prev) => prev.filter((p) => p.id !== id));

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    await runPromise(
      SourceService.pipe(
        Effect.flatMap((svc) => svc.remove(id)),
        Effect.catchAll((err) => {
          console.error("Failed to remove source:", err);
          return Effect.void;
        }),
      ),
    );
    setConfirmingDeleteId(null);
    await loadSources();
    setRemovingId(null);
  };

  const handleGithubConnect = async () => {
    const token = githubToken.trim();
    if (!token) return;
    setGithubStatus("verifying");
    setGithubMessage("");
    try {
      const res = await fetch("/_/api/github/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const err = await res.text();
        setGithubStatus("error");
        setGithubMessage(err || "Verification failed");
        return;
      }
      // Token is valid — persist it and add the cloud source
      await runPromise(ConfigService.pipe(Effect.flatMap((svc) => svc.set("github-token", token))));
      // Add the cloud source if not already present
      const existing = sources.find((s) => s.agentType === "github-cloud");
      if (!existing) {
        await runPromise(SourceService.pipe(Effect.flatMap((svc) => svc.add("", "github-cloud"))));
        await loadSources();
      }
      setSavedToken(token);
      setGithubStatus("connected");
      setGithubMessage("Connected successfully");
    } catch (err) {
      setGithubStatus("error");
      setGithubMessage(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const handleGithubDisconnect = async () => {
    await runPromise(ConfigService.pipe(Effect.flatMap((svc) => svc.set("github-token", ""))));
    setSavedToken("");
    setGithubToken("");
    setGithubStatus("idle");
    setGithubMessage("");
    // Remove the cloud source
    const cloudSource = sources.find((s) => s.agentType === "github-cloud");
    if (cloudSource) {
      await runPromise(SourceService.pipe(Effect.flatMap((svc) => svc.remove(cloudSource.id))));
      await loadSources();
    }
  };

  const handleThemeNameChange = async (name: ThemeName) => {
    setThemeName(name);
    await runPromise(
      ConfigService.pipe(
        Effect.flatMap((svc) => svc.set("theme-name", name)),
        Effect.catchAll(() => Effect.void),
      ),
    );
  };

  const handleThemeModeChange = async (mode: ThemeMode) => {
    setTheme(mode);
    await runPromise(
      ConfigService.pipe(
        Effect.flatMap((svc) => svc.set("theme-mode", mode)),
        Effect.catchAll(() => Effect.void),
      ),
    );
  };

  const handleReset = async () => {
    setResetting(true);
    await runPromise(
      ConfigService.pipe(
        Effect.flatMap((svc) => svc.reset()),
        Effect.catchAll((err) => {
          console.error("Failed to reset:", err);
          return Effect.void;
        }),
        Effect.ensuring(
          Effect.sync(() => {
            setResetting(false);
            setResetStep(0);
            setResetConfirmText("");
          }),
        ),
      ),
    );
  };

  const handleResetClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal isOpen={isOpen} onClose={handleResetClose} title="Settings" size="lg">
      <div className="flex gap-0 h-[460px]">
        {/* Sidebar tabs */}
        <div className="w-40 shrink-0 border-r border-ov-border -ml-5 -my-5 pl-5 pt-5 sticky top-0 self-start">
          <nav className="flex flex-col gap-0.5 pr-4">
            {(
              [
                "agent",
                "github",
                "notifications",
                "appearance",
                "privacy",
                "developer",
                "about",
              ] as const
            ).map((tab) => (
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
                  : tab === "github"
                    ? "GitHub"
                    : tab === "notifications"
                      ? "Notifications"
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
                    {/* Pending (optimistic) source rows: loading or error */}
                    {pendingSources.map((p) => (
                      <div
                        key={`pending-${p.id}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ov-bg-secondary border border-ov-border text-xs"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-ov-text">
                            {p.agentType}
                            {p.status === "loading" && (
                              <span className="text-ov-text-secondary"> · adding…</span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-ov-text-secondary font-mono">
                            {p.path}
                          </p>
                        </div>
                        {p.status === "loading" ? (
                          <Loader2 className="size-3 animate-spin text-ov-text-secondary" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => dismissPending(p.id)}
                            className="shrink-0 p-1 text-red-400 hover:text-red-300 cursor-pointer transition-colors"
                            title={p.error ?? "Error adding source"}
                          >
                            <TriangleAlert className="size-3" />
                          </button>
                        )}
                      </div>
                    ))}
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
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            className="shrink-0 px-2 py-1 text-xs rounded-md border border-ov-border text-ov-text-secondary hover:text-ov-text cursor-pointer transition-colors"
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
                          <button
                            type="button"
                            disabled={removingId === source.id}
                            onClick={() => setConfirmingDeleteId(source.id)}
                            className="shrink-0 p-1 text-ov-text-secondary hover:text-red-400 disabled:opacity-40 cursor-pointer transition-colors"
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
                </>
              )}

              {sources.length === 0 && !sourcesLoading && discovering && (
                <div className="flex items-center gap-2 text-xs text-ov-text-secondary mb-2">
                  <Loader2 className="size-3 animate-spin" />
                  Scanning for agent data directories…
                </div>
              )}

              {sources.length === 0 &&
                !sourcesLoading &&
                !discovering &&
                discoveredSources.length === 0 && (
                  <p className="text-xs text-ov-text-secondary mb-2">No sources configured.</p>
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
                  className="flex-1 text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px var(--color-glow)] font-mono"
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
                <button
                  type="button"
                  disabled={!addingPath.trim()}
                  onClick={handleAdd}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent-border bg-accent-muted text-accent hover:bg-accent/20"
                >
                  <Plus className="size-3" />
                  Add
                </button>
              </div>

              {!discovering && discoveredSources.length > 0 && (
                <div className="space-y-1 mt-3">
                  <p className="text-[11px] font-medium text-ov-text-secondary mb-1">
                    Detected Agent Directories
                  </p>
                  {discoveredSources.map((d) => (
                    <div
                      key={`discovered-${d.agentType}-${d.path}`}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-ov-bg-secondary border border-dashed border-ov-border/60 text-xs"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-ov-text">
                          {d.agentType}
                          {d.label && ` · ${d.label}`}
                          <span className="ml-1.5 text-[10px] text-ov-text-secondary italic">
                            suggested
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-ov-text-secondary font-mono">
                          {d.path}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddDiscovered(d)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border cursor-pointer transition-colors border-accent-border bg-accent-muted text-accent hover:bg-accent/20 shrink-0"
                      >
                        <Plus className="size-3" />
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "github" && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
                GitHub Cloud
              </h3>
              <p className="text-xs text-ov-text-secondary mb-3">
                Connect your GitHub account to track cloud agent sessions alongside your local ones.
                Requires a{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  fine-grained PAT
                </a>{" "}
                with "Agent tasks" repository read permission.
              </p>

              <div className="space-y-3">
                {/* Token input */}
                <div>
                  <label className="text-[11px] font-medium text-ov-text-secondary block mb-1">
                    Personal Access Token
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showToken ? "text" : "password"}
                        value={githubToken}
                        onChange={(e) => {
                          setGithubToken(e.target.value);
                          if (e.target.value !== savedToken) {
                            setGithubStatus("idle");
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleGithubConnect();
                        }}
                        placeholder="github_pat_..."
                        className="w-full text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 pr-8 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)] font-mono"
                        disabled={githubStatus === "verifying"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ov-text-secondary hover:text-ov-text cursor-pointer"
                      >
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    {savedToken ? (
                      <button
                        type="button"
                        onClick={handleGithubDisconnect}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors shrink-0"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!githubToken.trim() || githubStatus === "verifying"}
                        onClick={handleGithubConnect}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-accent-border bg-accent-muted text-accent hover:bg-accent/20 shrink-0"
                      >
                        {githubStatus === "verifying" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Cloud size={14} />
                        )}
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {/* Status message */}
                {githubStatus === "connected" && (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs">
                    <Check size={14} className="text-emerald-400 shrink-0" />
                    <span className="text-emerald-400/90">{githubMessage}</span>
                  </div>
                )}
                {githubStatus === "error" && (
                  <div className="flex items-center gap-2 p-2.5 rounded-md border border-red-500/30 bg-red-500/10 text-xs">
                    <TriangleAlert size={14} className="text-red-400 shrink-0" />
                    <span className="text-red-400/90">{githubMessage}</span>
                  </div>
                )}

                {/* Source status */}
                {savedToken && (
                  <div className="p-3 rounded-md border border-ov-border bg-ov-bg-secondary text-xs">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Cloud size={14} className="text-accent" />
                      <span className="text-ov-text font-medium">GitHub Cloud</span>
                      <span className="sess-agent-badge sess-agent-badge--github-cloud">
                        Active
                      </span>
                    </div>
                    <p className="text-ov-text-secondary">
                      Cloud agent sessions will appear in the session list with a "GitHub Cloud"
                      badge. Session status (queued, in progress, completed, needs input) is tracked
                      automatically.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <NotificationsSettingsTab
              settings={notificationSettings ?? null}
              onSave={(s) => onSaveNotificationSettings?.(s)}
            />
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
                Browse, search, and manage all your AI coding sessions from one place. Omnivue reads
                agent session databases in read-only mode, indexes their content for full-text
                search, and displays conversations, plans, diffs, and tool calls in a unified
                browser UI. Supports OpenCode, GitHub Copilot, Cursor, Pi, and Codex.
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

              {/* Factory Reset */}
              <div className="border-t border-ov-border pt-4 mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-red-400 mb-1">
                  Factory Reset
                </h4>
                <p className="text-xs text-ov-text-secondary mb-3">
                  Remove all Omnivue-local data including sources, folders, scratch notes,
                  bookmarks, search index, and configuration. Agent data on disk is unaffected.
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
                        This will permanently remove all local data: sources, folders, bookmarks,
                        scratch notes, search index, and settings. Agent data on disk is safe and
                        can be re-added. This action cannot be undone.
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
          )}
        </div>
      </div>
    </Modal>
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
