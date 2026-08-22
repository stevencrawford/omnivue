import { useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { FileGraph, FileGraphNode, Session } from "../hooks/types";
import { useFileGraph } from "../hooks/useFileGraph";
import { FileNode, type FileNodeData } from "./files/FileGraphNode";
import { LoadingState } from "./ui/LoadingState";

interface FileGraphViewProps {
  sessions: Session[];
  onFileSearch: (path: string) => void;
  onSessionSelect: (sessionId: string) => void;
}

// SESSION_LIST_CAP keeps the detail panel bounded for hub files touched by
// dozens of sessions; the remainder collapses into a "+N more" line.
const SESSION_LIST_CAP = 8;

interface SimNode extends SimulationNodeDatum, FileGraphNode {
  id: string;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

function layout(
  graph: FileGraph,
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n, id: n.path }));
  const links = graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation<SimNode>(nodes)
    .force("charge", forceManyBody().strength(-140))
    .force(
      "link",
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance(70),
    )
    .force("center", forceCenter(width / 2, height / 2))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => (Math.sqrt(d.total) * 3.2) / 2 + 14),
    )
    .stop();
  sim.tick(320);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }
  return positions;
}

export function FileGraphView({ sessions, onFileSearch, onSessionSelect }: FileGraphViewProps) {
  const repos = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.repository).filter(Boolean))).sort(),
    [sessions],
  );
  const agents = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.agent))).sort(),
    [sessions],
  );

  const [agent, setAgent] = useState("");
  const [repo, setRepo] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<FileGraphNode | null>(null);

  const { graph, loading, error } = useFileGraph({ agent, repo, from, to });
  const { ref, size } = useElementSize<HTMLDivElement>();

  const rfNodes: Node<FileNodeData>[] = useMemo(() => {
    if (!graph) return [];
    const positions = layout(graph, size.width, size.height);
    return graph.nodes.map((n) => {
      const pos = positions.get(n.path) ?? { x: 0, y: 0 };
      return {
        id: n.path,
        type: "file",
        position: pos,
        data: {
          path: n.path,
          reads: n.reads,
          writes: n.writes,
          total: n.total,
          sessions: n.sessions,
        },
      };
    });
  }, [graph, size.width, size.height]);

  const rfEdges: Edge[] = useMemo(() => {
    if (!graph) return [];
    return graph.edges.map((e) => ({
      id: `${e.source}__${e.target}`,
      source: e.source,
      target: e.target,
      style: {
        strokeWidth: Math.min(5, 0.5 + Math.log2(e.weight + 1)),
        stroke: "rgba(140,160,180,0.45)",
      },
    }));
  }, [graph]);

  const selectedNode =
    selected && graph ? (graph.nodes.find((n) => n.path === selected.path) ?? null) : null;

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const selectedSessions = useMemo(() => {
    if (!selectedNode) return [];
    return selectedNode.sessionIds
      .map((id) => sessionById.get(id))
      .filter((s): s is Session => Boolean(s));
  }, [selectedNode, sessionById]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-ov-border px-3 py-2 text-xs">
        <span className="font-medium text-ov-text-secondary">Touched files</span>
        <select
          className="rounded border border-ov-border bg-ov-bg px-2 py-1"
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-ov-border bg-ov-bg px-2 py-1"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        >
          <option value="">All repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded border border-ov-border bg-ov-bg px-2 py-1"
          value={from}
          onChange={(e) => setFrom(e.target.value ? new Date(e.target.value).toISOString() : "")}
        />
        <span className="text-ov-text-secondary">→</span>
        <input
          type="date"
          className="rounded border border-ov-border bg-ov-bg px-2 py-1"
          value={to}
          onChange={(e) => setTo(e.target.value ? new Date(e.target.value).toISOString() : "")}
        />
        <div className="ml-auto flex items-center gap-3 text-ov-text-secondary">
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-full bg-[#06b6d4]" /> read
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-full bg-[#f59e0b]" /> write
          </span>
          <span>size = total touches; bar = read/write split</span>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        <div ref={ref} className="relative flex-1">
          {loading && <LoadingState label="Building file graph..." />}
          {!loading && error && (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ov-text-secondary">
              Failed to load graph: {error}
            </div>
          )}
          {!loading && !error && graph && graph.nodes.length === 0 && (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ov-text-secondary">
              No file activity for the current filters.
            </div>
          )}
          {!loading && !error && graph && graph.nodes.length > 0 && (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={{ file: FileNode }}
              fitView
              minZoom={0.1}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => setSelected(node.data as unknown as FileGraphNode)}
            >
              <Background color="#2a2f37" gap={22} />
              <Controls />
              <MiniMap pannable zoomable nodeColor="#64748b" />
            </ReactFlow>
          )}
        </div>

        {selectedNode && (
          <div className="w-56 shrink-0 border-l border-ov-border bg-ov-bg-sidebar p-3 text-xs">
            <div className="mb-2 break-all font-mono text-[11px] text-ov-text">
              {selectedNode.path}
            </div>
            <dl className="space-y-1 text-ov-text-secondary">
              <div className="flex justify-between">
                <dt>Reads</dt>
                <dd className="text-ov-text">{selectedNode.reads}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Writes</dt>
                <dd className="text-ov-text">{selectedNode.writes}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Sessions</dt>
                <dd className="text-ov-text">{selectedNode.sessions}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <div className="mb-1 font-medium text-ov-text-secondary">Sessions</div>
              <ul className="space-y-0.5">
                {selectedSessions.slice(0, SESSION_LIST_CAP).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-1 py-0.5 text-left text-accent hover:bg-ov-bg-sidebar"
                      title={s.title}
                      onClick={() => onSessionSelect(s.id)}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
                {selectedSessions.length > SESSION_LIST_CAP && (
                  <li className="px-1 py-0.5 text-ov-text-secondary">
                    +{selectedSessions.length - SESSION_LIST_CAP} more
                  </li>
                )}
                {selectedSessions.length === 0 && (
                  <li className="px-1 py-0.5 text-ov-text-secondary">Session list unavailable</li>
                )}
              </ul>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded border border-ov-border bg-ov-bg px-2 py-1 text-accent hover:bg-ov-bg-sidebar"
              onClick={() => onFileSearch(selectedNode.path)}
            >
              Search sessions
            </button>
            <button
              type="button"
              className="mt-2 w-full rounded border border-ov-border px-2 py-1 text-ov-text-secondary hover:text-ov-text"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
