import { useEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";
import type { Message } from "../hooks/useApi";
import { effectiveToolKind, getToolSummary } from "../utils/toolDisplay";
import { toolRendererRegistry } from "./ToolRenderers/registry";

const LEGACY_MARKER_COLORS: Record<string, string> = {
  "user-request": "#58a6ff",
  thinking: "#a78bfa",
  "assistant-text": "#8b949e",
};

const LEGACY_MARKER_LABELS: Record<string, string> = {
  "user-request": "User requests",
  thinking: "Thinking",
  "assistant-text": "Assistant Message",
};

interface MarkerDef {
  id: string;
  type: string;
  summary: string;
  color: string;
  label: string;
}

function computeMarkers(messages: Message[]): MarkerDef[] {
  const result: MarkerDef[] = [];
  messages.forEach((msg, idx) => {
    if (msg.role === "user") {
      result.push({
        id: `msg-${idx}`,
        type: "user-request",
        summary: msg.content?.slice(0, 120) || "",
        color: LEGACY_MARKER_COLORS["user-request"],
        label: LEGACY_MARKER_LABELS["user-request"],
      });
      return;
    }
    if (msg.role === "assistant") {
      const tools = (msg.toolCalls ?? []).filter((t) => t.name !== "report_intent");
      if (tools.length > 0) {
        const dtList = toolRendererRegistry.allMarkerDisplayTypes();
        const toolKinds = tools.map((t) => effectiveToolKind(t));
        let dominantKind = "tool";
        for (const { displayType } of dtList) {
          const matched = toolKinds.find(
            (k) => toolRendererRegistry.markerForKind(k).displayType === displayType,
          );
          if (matched) {
            dominantKind = matched;
            break;
          }
        }
        const domToolIdx = toolKinds.indexOf(dominantKind);
        const domTool = domToolIdx >= 0 ? tools[domToolIdx] : tools[0];
        const marker = toolRendererRegistry.markerForKind(dominantKind);
        result.push({
          id: `msg-${idx}`,
          type: marker.displayType,
          summary: getToolSummary(domTool, msg.agent),
          color: marker.color,
          label: marker.label,
        });
      } else if (msg.reasoning) {
        result.push({
          id: `msg-${idx}`,
          type: "thinking",
          summary: msg.reasoning.slice(0, 120),
          color: LEGACY_MARKER_COLORS["thinking"],
          label: LEGACY_MARKER_LABELS["thinking"],
        });
      } else if (msg.content?.trim()) {
        result.push({
          id: `msg-${idx}`,
          type: "assistant-text",
          summary: msg.content.slice(0, 120),
          color: LEGACY_MARKER_COLORS["assistant-text"],
          label: LEGACY_MARKER_LABELS["assistant-text"],
        });
      }
    }
  });
  return result;
}

function allMarkerLegendTypes() {
  const map = new Map<string, { label: string; color: string }>();
  map.set("user-request", {
    label: LEGACY_MARKER_LABELS["user-request"],
    color: LEGACY_MARKER_COLORS["user-request"],
  });
  map.set("thinking", {
    label: LEGACY_MARKER_LABELS["thinking"],
    color: LEGACY_MARKER_COLORS["thinking"],
  });
  for (const { displayType } of toolRendererRegistry.allMarkerDisplayTypes()) {
    const marker = toolRendererRegistry.markerForDisplayType(displayType);
    map.set(displayType, { label: marker.label, color: marker.color });
  }
  map.set("assistant-text", {
    label: LEGACY_MARKER_LABELS["assistant-text"],
    color: LEGACY_MARKER_COLORS["assistant-text"],
  });
  return Array.from(map.entries()).map(([type, { label, color }]) => ({
    type,
    label,
    color,
  }));
}

export function ScrollMarkers({
  messages,
  scrollRef,
  markerPositions,
}: {
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  markerPositions: Record<string, number>;
}) {
  const [markerFilterOpen, setMarkerFilterOpen] = useState(false);
  const [hiddenMarkerTypes, setHiddenMarkerTypes] = useState<Set<string>>(new Set());

  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!markerFilterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setMarkerFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [markerFilterOpen]);

  const markers = useMemo(() => computeMarkers(messages), [messages]);
  const legendTypes = useMemo(() => allMarkerLegendTypes(), []);

  if (markers.length === 0) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 z-10 group" style={{ width: "28px" }}>
      <div
        className={`absolute right-0 top-0 bottom-0 pointer-events-none transition-all duration-150 ${markerFilterOpen ? "w-12" : "w-3 group-hover:w-12"}`}
      >
        <div className="relative h-full w-full">
          <div ref={filterRef} className="absolute top-1 left-1/2 -translate-x-1/2 z-20">
            <div className="relative pointer-events-auto">
              <button
                type="button"
                onClick={() => setMarkerFilterOpen((v) => !v)}
                className="size-4 flex items-center justify-center rounded text-gh-text-secondary/50 hover:text-gh-text hover:bg-gh-bg-hover transition-colors cursor-pointer"
                title="Filter markers"
              >
                <Filter size={12} />
              </button>
              {markerFilterOpen && (
                <div className="absolute right-full top-0 mr-2 z-50 bg-gh-bg-secondary border border-gh-border rounded-lg shadow-xl min-w-36 max-h-60 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setHiddenMarkerTypes(
                        hiddenMarkerTypes.size > 0
                          ? new Set()
                          : new Set(legendTypes.map((t) => t.type)),
                      );
                    }}
                    className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-gh-bg-hover transition-colors cursor-pointer border-b border-gh-border"
                  >
                    {hiddenMarkerTypes.size > 0 ? "Select all" : "Deselect all"}
                  </button>
                  {legendTypes.map(({ type, label, color }) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 px-3 py-1 text-[11px] cursor-pointer hover:bg-gh-bg-hover transition-colors whitespace-nowrap"
                    >
                      <input
                        type="checkbox"
                        checked={!hiddenMarkerTypes.has(type)}
                        onChange={() => {
                          setHiddenMarkerTypes((prev) => {
                            const next = new Set(prev);
                            if (next.has(type)) next.delete(type);
                            else next.add(type);
                            return next;
                          });
                        }}
                        className="accent-accent"
                      />
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {markers
            .filter((m) => !hiddenMarkerTypes.has(m.type))
            .map((m) => {
              const pos = markerPositions[m.id];
              if (pos === undefined) return null;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`absolute cursor-pointer transition-all pointer-events-auto ${markerFilterOpen ? "left-0 -translate-x-0 w-full h-0.5 rounded-none opacity-100" : "left-1/2 -translate-x-1/2 w-1.5 h-1 rounded-full opacity-30 group-hover:left-0 group-hover:-translate-x-0 group-hover:w-full group-hover:h-0.5 group-hover:rounded-none group-hover:opacity-100"} hover:opacity-100 hover:[&>div]:block`}
                  style={{
                    top: `${Math.max(0, Math.min(100, pos))}%`,
                    backgroundColor: m.color,
                  }}
                  onClick={() => {
                    const el = scrollRef.current?.querySelector(`[data-marker-id="${m.id}"]`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 hidden bg-gh-bg-secondary border border-gh-border rounded-md px-2 py-1 text-xs whitespace-nowrap z-30 shadow-lg pointer-events-none">
                    <div className="font-medium text-[10px] uppercase tracking-wider opacity-60">
                      {m.label}
                    </div>
                    <div className="text-gh-text truncate max-w-56">{m.summary}</div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
