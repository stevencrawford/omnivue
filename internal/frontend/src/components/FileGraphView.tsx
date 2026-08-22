import { useEffect, useMemo, useRef } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { FileGraph, FileGraphNode, FilesFilters, Session } from "../hooks/types";
import { useTheme } from "../hooks/useTheme";
import { FileNode, nodeDiameter } from "./files/FileGraphNode";
import { FileDetail } from "./files/FileDetail";

interface FileGraphViewProps {
  sessions: Session[];
  filters: FilesFilters;
  graph: FileGraph | null;
  loading: boolean;
  error: string | null;
  selectedPath: string;
  onFileSelect: (path: string) => void;
  onSessionSelect: (sessionId: string) => void;
}

interface SimNode extends SimulationNodeDatum, FileGraphNode {
  id: string;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const sizeRef = useRef({ width: 800, height: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      sizeRef.current = { width: el.clientWidth, height: el.clientHeight };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, sizeRef };
}

// Layout runs once per graph (not per resize) so user-dragged node positions
// survive re-renders; the canvas size at fetch time is captured via ref.
function layout(graph: FileGraph): Map<string, { x: number; y: number }> {
  const nodes: SimNode[] = graph.nodes.map((n) => ({ ...n, id: n.path }));
  const links = graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation<SimNode>(nodes)
    .force("charge", forceManyBody().strength(-420))
    .force(
      "link",
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance(110),
    )
    .force("center", forceCenter(400, 300))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => nodeDiameter(d.total, maxTotalOf(graph)) / 2 + 12),
    )
    .stop();
  sim.tick(400);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }
  return positions;
}

function maxTotalOf(graph: FileGraph): number {
  return Math.max(1, ...graph.nodes.map((n) => n.total));
}

export function FileGraphView({
  sessions,
  filters,
  graph,
  loading,
  error,
  selectedPath,
  onFileSelect,
  onSessionSelect,
}: FileGraphViewProps) {
  const { themeMode } = useTheme();
  const { ref, sizeRef } = useElementSize<HTMLDivElement>();

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.path === selectedPath) ?? null,
    [graph, selectedPath],
  );

  const baseDir = useMemo(() => {
    const dirs = sessions
      .filter((s) => s.repository === filters.repo)
      .map((s) => s.directory)
      .filter(Boolean) as string[];
    return dirs[0];
  }, [sessions, filters.repo]);

  // Nodes are uncontrolled (defaultNodes) so React Flow owns drag state;
  // the memo only recomputes when a new graph arrives.
  const defaultNodes = useMemo(() => {
    if (!graph) return [];
    void sizeRef.current;
    const positions = layout(graph);
    const maxTotal = maxTotalOf(graph);
    return graph.nodes.map((n) => ({
      id: n.path,
      type: "file",
      position: positions.get(n.path) ?? { x: 0, y: 0 },
      data: {
        path: n.path,
        reads: n.reads,
        writes: n.writes,
        total: n.total,
        sessions: n.sessions,
        maxTotal,
      },
    }));
  }, [graph, sizeRef]);
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

  if (!filters.repo) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-ov-text-secondary">
        Select a project in the sidebar to explore its touched files.
      </div>
    );
  }

  if (selectedNode) {
    return (
      <FileDetail
        node={selectedNode}
        sessions={sessions}
        baseDir={baseDir}
        onSessionSelect={onSessionSelect}
        onBack={() => onFileSelect("")}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ov-border px-3 py-2 text-xs">
        <span className="font-medium text-ov-text">{filters.repo}</span>
        <div className="ml-auto flex items-center gap-3 text-ov-text-secondary">
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-full bg-[#06b6d4]" /> read
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-full bg-[#f59e0b]" /> write
          </span>
          <span>size = touches relative to busiest file · drag nodes to rearrange</span>
        </div>
      </div>

      <div ref={ref} className="relative flex-1">
        {loading && (
          <div className="flex h-full items-center justify-center p-4 text-sm text-ov-text-secondary">
            Building file graph…
          </div>
        )}
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
            defaultNodes={defaultNodes}
            defaultEdges={rfEdges}
            nodeTypes={{ file: FileNode }}
            fitView
            minZoom={0.05}
            maxZoom={2.5}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onFileSelect(node.id)}
          >
            <Background color={themeMode === "dark" ? "#1a1f28" : "#dcdde0"} gap={22} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor="#64748b"
              maskColor={themeMode === "dark" ? "rgba(11,14,20,0.7)" : "rgba(250,250,250,0.7)"}
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
