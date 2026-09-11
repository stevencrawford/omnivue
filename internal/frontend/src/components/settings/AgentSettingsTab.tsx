import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Plus, Loader2, TriangleAlert } from "lucide-react";
import type { Source, DiscoveredSource } from "../../hooks/types";
import {
  fetchSources,
  fetchDiscoveredSources,
  addSource,
  removeSource,
} from "../../hooks/apiClient";
import { makeId } from "../../utils/uuid";
import { FilterChip } from "../ui/FilterChip";

const AGENT_TYPES = [
  { value: "opencode", label: "OpenCode", disabled: false, defaultPath: "~/.local/share/opencode" },
  { value: "copilot", label: "Copilot", disabled: false, defaultPath: "~/.copilot" },
  { value: "claude-code", label: "Claude Code", disabled: false, defaultPath: "~/.claude" },
  { value: "codex", label: "Codex", disabled: false, defaultPath: "~/.codex" },
  { value: "cursor", label: "Cursor", disabled: false, defaultPath: "~/.cursor" },
  { value: "pi", label: "Pi", disabled: false, defaultPath: "~/.pi/agent/sessions" },
];

interface PendingSource {
  id: string;
  path: string;
  agentType: string;
  status: "loading" | "error";
  error?: string;
}

export function AgentSettingsTab() {
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

  const loadSources = useCallback(async (opts?: { skipDiscover?: boolean }) => {
    setSourcesLoading(true);
    setSourcesError(null);
    let srcs: Source[] = [];
    try {
      srcs = await fetchSources();
    } catch {
      setSourcesError("Failed to load sources");
      srcs = [];
    }
    setSources(srcs);
    setSourcesLoading(false);

    if (srcs.length === 0 && !opts?.skipDiscover && !discoveredRef.current) {
      discoveredRef.current = true;
      setDiscovering(true);
      let discovered: DiscoveredSource[] = [];
      try {
        discovered = await fetchDiscoveredSources();
      } catch {
        discovered = [];
      }
      setDiscoveredSources(discovered);
      setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
    setAddingPath("");
    setAddingType("opencode");
    setConfirmingDeleteId(null);
    setAgentFilter(null);
    setPendingSources((prev) => prev.filter((p) => p.status === "loading"));
  }, [loadSources]);

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
    const pendingId = makeId();
    setPendingSources((prev) => [...prev, { id: pendingId, path, agentType, status: "loading" }]);
    setAddingPath("");
    try {
      await addSource(path, agentType);
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
    const pendingId = makeId();
    setPendingSources((prev) => [
      ...prev,
      { id: pendingId, path: d.path, agentType: d.agentType, status: "loading" },
    ]);
    setDiscoveredSources((prev) => prev.filter((s) => s.path !== d.path));
    try {
      await addSource(d.path, d.agentType);
      await loadSources();
      setPendingSources((prev) => prev.filter((p) => p.id !== pendingId));
    } catch (err) {
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
    try {
      await removeSource(id);
    } catch (err) {
      console.error("Failed to remove source:", err);
    }
    setConfirmingDeleteId(null);
    await loadSources();
    setRemovingId(null);
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-ov-text-secondary mb-1">
        Agent Directories
      </h3>
      <p className="text-xs text-ov-text-secondary mb-3">
        Add or remove agent data directories. Omnivue reads from these paths to discover sessions.
      </p>

      {sourcesLoading ? (
        <p className="text-xs text-ov-text-secondary">Loading...</p>
      ) : sourcesError ? (
        <p className="text-xs text-red-400">{sourcesError}</p>
      ) : (
        <>
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
                  <p className="truncate text-[11px] text-ov-text-secondary font-mono">{p.path}</p>
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
                      Removes all information local to Omnivue. Agent data unaffected. Confirm?
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

      <div className="flex items-center gap-2 mt-2">
        <input
          type="text"
          value={addingPath}
          onChange={(e) => setAddingPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={
            AGENT_TYPES.find((at) => at.value === addingType)?.defaultPath ?? "/path/to/agent/data"
          }
          className="flex-1 text-xs bg-ov-bg border border-ov-border rounded-md px-2 py-1.5 text-ov-text placeholder:text-ov-text-secondary outline-none focus:border-accent focus:shadow-[0_0_0_2px_var(--color-glow)] font-mono"
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
                <p className="truncate text-[11px] text-ov-text-secondary font-mono">{d.path}</p>
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
  );
}
