import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

// FileNodeData is the per-node payload rendered by FileNode. It must satisfy
// React Flow's Record<string, unknown> constraint on node data.
export interface FileNodeData {
  path: string;
  reads: number;
  writes: number;
  total: number;
  sessions: number;
  /** Largest total across the current graph; sizes are relative to it. */
  maxTotal: number;
  [key: string]: unknown;
}

const SIZE_MIN = 22;
const SIZE_MAX = 84;

// nodeDiameter scales relative to the busiest file in the current graph so the
// spread of touch counts is always visible — an absolute scale flattens to
// uniform dots whenever most files have single-digit touches.
export function nodeDiameter(total: number, maxTotal: number): number {
  const t = Math.sqrt(Math.max(0, total) / Math.max(1, maxTotal));
  return SIZE_MIN + (SIZE_MAX - SIZE_MIN) * t;
}

// dominantColor blends cyan (read-dominant) and amber (write-dominant) by the
// relative share of read vs write touches, so at a glance a node shows its
// access character.
function dominantColor(reads: number, writes: number): string {
  if (writes === 0) return "#06b6d4";
  if (reads === 0) return "#f59e0b";
  const total = reads + writes;
  const readRatio = reads / total;
  const r = Math.round(6 + (245 - 6) * (1 - readRatio));
  const g = Math.round(182 + (158 - 182) * (1 - readRatio));
  const b = Math.round(212 + (11 - 212) * (1 - readRatio));
  return `rgb(${r}, ${g}, ${b})`;
}

export const FileNode = memo(function FileNode({ data, selected }: NodeProps) {
  const d = data as FileNodeData;
  const size = nodeDiameter(d.total, d.maxTotal);
  const color = dominantColor(d.reads, d.writes);
  const label = d.path.split("/").pop() || d.path;
  const title = `${d.path}\nreads: ${d.reads}  writes: ${d.writes}  sessions: ${d.sessions}`;
  // Read/write share rendered as a two-segment bar, so a mixed file shows its
  // blend explicitly instead of only through the node's blended fill color.
  const total = Math.max(1, d.reads + d.writes);
  const readPct = (d.reads / total) * 100;

  return (
    <div className="flex flex-col items-center" style={{ width: SIZE_MAX }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        title={title}
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          background: color,
          boxShadow: selected ? "0 0 0 3px var(--color-accent)" : "0 1px 3px rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.25)",
          cursor: "pointer",
        }}
      />
      <div
        aria-hidden
        className="mt-1 flex h-1 overflow-hidden rounded-full"
        style={{ width: size }}
        title={`reads ${d.reads} / writes ${d.writes}`}
      >
        {d.reads > 0 && <div style={{ width: `${readPct}%`, background: "#06b6d4" }} />}
        {d.writes > 0 && <div style={{ width: `${100 - readPct}%`, background: "#f59e0b" }} />}
      </div>
      <span
        className="mt-1 max-w-[120px] truncate text-[10px] text-ov-text-secondary"
        title={label}
        style={{ width: SIZE_MAX }}
      >
        {label}
      </span>
    </div>
  );
});
