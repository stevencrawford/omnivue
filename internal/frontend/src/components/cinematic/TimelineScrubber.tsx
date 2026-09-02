import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, ChevronDown } from "lucide-react";
import type { TimelineEvent } from "../../hooks/useTimeline";

interface TimelineScrubberProps {
  events: TimelineEvent[];
  cursor: number;
  maxIndex: number;
  playing: boolean;
  speed?: number;
  onSpeedChange?: (next: number) => void;
  onCursorChange: (next: number) => void;
  onEndScrub: () => void;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onGoLive: () => void;
  atLive: boolean;
  behind: number;
  isActive: boolean;
  selectedSpan?: { start: number; end: number } | null;
  onSpanSelect?: (start: number, end: number) => void;
  onClearSpan?: () => void;
}

export function TimelineScrubber({
  events,
  cursor,
  maxIndex,
  playing,
  speed = 1,
  onSpeedChange,
  onCursorChange,
  onEndScrub,
  onTogglePlay,
  onStep,
  onGoLive,
  atLive,
  behind,
  isActive,
  selectedSpan = null,
  onSpanSelect,
  onClearSpan,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!speedOpen) return;
    const handler = (e: MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) setSpeedOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSpeedOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [speedOpen]);

  const pct = maxIndex > 0 ? (cursor / maxIndex) * 100 : 0;

  const userEvents = useMemo(() => events.filter((ev) => ev.kind === "user-request"), [events]);
  const userIndices = useMemo(() => userEvents.map((ev) => ev.index), [userEvents]);
  const spans = useMemo(() => {
    if (userIndices.length === 0 || events.length === 0) return [];
    const out: Array<{ start: number; end: number; idx: number }> = [];
    for (let i = 0; i < userIndices.length - 1; i++) {
      out.push({ start: userIndices[i], end: userIndices[i + 1], idx: i });
    }
    // trailing span from last user prompt to end of session (inclusive of last user's turn)
    const last = userIndices[userIndices.length - 1];
    out.push({ start: last, end: events.length, idx: out.length });
    return out;
  }, [userIndices, events.length]);

  const hasSpans = spans.length > 0;

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || maxIndex <= 0) return;
      const rect = el.getBoundingClientRect();
      const rel = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onCursorChange(Math.round(rel * maxIndex));
    },
    [maxIndex, onCursorChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // if a span is selected, dragging should clear selection and start scrubbing
      if (selectedSpan && onClearSpan) onClearSpan();
      draggingRef.current = true;
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [updateFromClientX, selectedSpan, onClearSpan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore if capture already released
      }
      onEndScrub();
    },
    [onEndScrub],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      onEndScrub();
      e.stopPropagation();
    },
    [onEndScrub],
  );

  const handleThumbPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (selectedSpan && onClearSpan) onClearSpan();
      draggingRef.current = true;
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
      updateFromClientX(e.clientX);
    },
    [updateFromClientX, selectedSpan, onClearSpan],
  );

  const handleThumbPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const handleThumbPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // pointer capture may have been released already
      }
      onEndScrub();
      e.stopPropagation();
    },
    [onEndScrub],
  );

  const handleThumbPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      onEndScrub();
      e.stopPropagation();
    },
    [onEndScrub],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (selectedSpan && onClearSpan) onClearSpan();
      updateFromClientX(e.clientX);
      onEndScrub();
    },
    [updateFromClientX, onEndScrub, selectedSpan, onClearSpan],
  );

  const handleSpanClick = useCallback(
    (start: number, end: number, e: React.MouseEvent) => {
      e.stopPropagation();
      onSpanSelect?.(start, end);
    },
    [onSpanSelect],
  );

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-ov-border bg-ov-bg-secondary text-xs text-ov-text-secondary shrink-0">
        <span>No timeline events yet</span>
      </div>
    );
  }

  const selectedSpanLabel = selectedSpan
    ? (() => {
        const idx = spans.findIndex(
          (s) => s.start === selectedSpan.start && s.end === selectedSpan.end,
        );
        if (idx >= 0) return `Turn ${idx + 1}/${spans.length}`;
        return `${selectedSpan.start + 1}–${selectedSpan.end}/${events.length}`;
      })()
    : null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-ov-bg-secondary shrink-0"
      aria-label="Session timeline"
    >
      <button
        type="button"
        onClick={() => {
          if (selectedSpan && onClearSpan) onClearSpan();
          onStep(-1);
        }}
        disabled={selectedSpan ? false : cursor <= 0}
        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover disabled:opacity-30 cursor-pointer transition-colors"
        title="Previous event (←)"
        aria-label="Previous event"
      >
        <SkipBack size={14} />
      </button>
      <button
        type="button"
        onClick={onTogglePlay}
        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors"
        title={playing ? "Pause (Space)" : "Play (Space)"}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button
        type="button"
        onClick={() => {
          if (selectedSpan && onClearSpan) onClearSpan();
          onStep(1);
        }}
        disabled={selectedSpan ? false : cursor >= maxIndex}
        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover disabled:opacity-30 cursor-pointer transition-colors"
        title="Next event (→)"
        aria-label="Next event"
      >
        <SkipForward size={14} />
      </button>
      <div ref={speedRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setSpeedOpen((o) => !o)}
          className="h-6 px-1.5 flex items-center gap-0.5 rounded text-[11px] font-mono text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover cursor-pointer transition-colors border border-transparent hover:border-ov-border"
          title="Playback speed"
          aria-label="Playback speed"
          aria-haspopup="menu"
          aria-expanded={speedOpen}
        >
          <span className="tabular-nums">{speed}×</span>
          <ChevronDown
            size={10}
            className={`shrink-0 transition-transform ${speedOpen ? "rotate-180" : ""}`}
          />
        </button>
        {speedOpen && (
          <div
            className="absolute top-full mt-1 left-0 z-50 bg-ov-bg-secondary border border-ov-border rounded-md shadow-lg py-1 min-w-[64px]"
            role="menu"
          >
            {[1, 1.5, 2].map((v) => (
              <button
                key={v}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSpeedChange?.(v);
                  setSpeedOpen(false);
                }}
                className={`w-full text-left px-3 py-1 text-xs font-mono hover:bg-ov-bg-hover cursor-pointer transition-colors ${speed === v ? "text-accent bg-accent/10" : "text-ov-text-secondary"}`}
              >
                {v}×
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={trackRef}
        className="relative flex-1 h-7 flex items-center select-none touch-none"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={maxIndex}
        aria-valuenow={selectedSpan ? selectedSpan.end - 1 : cursor}
        aria-label="Timeline position"
        onClick={handleTrackClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {/* base track */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 bg-ov-border rounded-full overflow-hidden">
          {!selectedSpan && (
            <div
              className={`absolute left-0 top-0 bottom-0 bg-accent rounded-full ${isDragging ? "" : "transition-[width] duration-75"}`}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        {/* clickable spans between user messages (horizontal marker areas) */}
        {hasSpans ? (
          <>
            {spans.map((s) => {
              const isTrailing = s.end === events.length;
              const left = maxIndex > 0 ? (s.start / maxIndex) * 100 : 0;
              const width =
                maxIndex > 0 ? (isTrailing ? 100 - left : ((s.end - s.start) / maxIndex) * 100) : 0;
              const isSelected =
                selectedSpan !== null &&
                selectedSpan.start === s.start &&
                selectedSpan.end === s.end;
              const eventsInSpan = events.filter((ev) => ev.index > s.start && ev.index < s.end);
              return (
                <button
                  key={`span-${s.idx}`}
                  type="button"
                  onClick={(e) => handleSpanClick(s.start, s.end, e)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`absolute top-1/2 -translate-y-1/2 h-6 rounded flex items-center overflow-hidden border cursor-pointer transition-all duration-200 ease-out ${
                    isSelected
                      ? "bg-accent/20 border-accent/50 z-10"
                      : "bg-transparent border-transparent hover:bg-ov-bg-hover/50 hover:border-ov-border/50 z-[1]"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={
                    isSelected
                      ? `Selected turn ${s.idx + 1} — click to show all`
                      : isTrailing
                        ? `Turn ${s.idx + 1}: ${eventsInSpan.length} steps from last prompt to end — click to isolate`
                        : `Turn ${s.idx + 1}: ${eventsInSpan.length} steps between prompts — click to isolate`
                  }
                  aria-label={
                    isTrailing
                      ? `Turn ${s.idx + 1} from last prompt to end`
                      : `Turn ${s.idx + 1} between user messages`
                  }
                  aria-pressed={isSelected}
                >
                  {/* horizontal tool activity strip inside span */}
                  {eventsInSpan.length > 0 && (
                    <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 flex gap-px h-1 items-center overflow-hidden pointer-events-none">
                      {eventsInSpan.map((ev) => (
                        <div
                          key={ev.index}
                          className="flex-1 h-1 rounded-full min-w-px transition-all duration-200"
                          style={{
                            backgroundColor: ev.color,
                            opacity: isSelected ? 1 : ev.index <= cursor ? 0.9 : 0.35,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
            {/* leading activity before first user (non-clickable) */}
            {userIndices[0] > 0 && (
              <div
                className="absolute top-1/2 -translate-y-1/2 h-6 flex items-center overflow-hidden pointer-events-none"
                style={{
                  left: 0,
                  width: `${(userIndices[0] / maxIndex) * 100}%`,
                }}
                aria-hidden
              >
                {(() => {
                  const leading = events.filter((ev) => ev.index < userIndices[0]);
                  if (leading.length === 0) return null;
                  return (
                    <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 flex gap-px h-1 items-center overflow-hidden opacity-60">
                      {leading.map((ev) => (
                        <div
                          key={ev.index}
                          className="flex-1 h-1 rounded-full min-w-px transition-all duration-200"
                          style={{ backgroundColor: ev.color }}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        ) : (
          // fallback: no user prompts — show per-event horizontal ticks
          events.map((ev) => {
            const left = maxIndex > 0 ? (ev.index / maxIndex) * 100 : 0;
            const isUser = ev.kind === "user-request";
            if (isUser) return null; // user markers rendered below
            return (
              <div
                key={ev.index}
                className="absolute top-1/2 -translate-y-1/2 h-1 w-2 rounded-full -ml-1 pointer-events-none transition-all duration-200 ease-out"
                style={{
                  left: `${left}%`,
                  backgroundColor: ev.color,
                  opacity: selectedSpan ? 0.9 : ev.index <= cursor ? 1 : 0.25,
                }}
                title={`${ev.kind}: ${ev.label.slice(0, 80)}`}
              />
            );
          })
        )}

        {/* user message markers (always on top) */}
        {userEvents.map((ev) => {
          const left = maxIndex > 0 ? (ev.index / maxIndex) * 100 : 0;
          const isSelectedBoundary =
            selectedSpan !== null &&
            (ev.index === selectedSpan.start || ev.index === selectedSpan.end);
          return (
            <div
              key={`user-${ev.index}`}
              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 shadow -ml-1.5 pointer-events-none z-20 transition-all duration-200 ease-out ${
                isSelectedBoundary
                  ? "bg-accent border-accent ring-2 ring-accent/30"
                  : "bg-[#58a6ff] border-ov-bg"
              }`}
              style={{ left: `${left}%` }}
              title={`user: ${ev.label.slice(0, 80)}`}
            />
          );
        })}

        {/* thumb - draggable to scrub timeline, hidden when a span is isolated */}
        {!selectedSpan && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 -ml-2.5 size-5 flex items-center justify-center z-30 touch-none select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ left: `${pct}%` }}
            onPointerDown={handleThumbPointerDown}
            onPointerMove={handleThumbPointerMove}
            onPointerUp={handleThumbPointerUp}
            onPointerCancel={handleThumbPointerCancel}
            role="button"
            tabIndex={-1}
            aria-label="Drag to scrub timeline"
            title="Drag to jump to a point in the timeline"
          >
            <div
              className={`size-3 rounded-full bg-ov-bg border-2 border-accent shadow-sm transition-all duration-150 ease-out pointer-events-none ${isDragging ? "scale-125 shadow-md" : "hover:scale-110"}`}
            />
          </div>
        )}
      </div>

      <span className="text-[11px] font-mono text-ov-text-secondary tabular-nums shrink-0">
        {selectedSpan ? selectedSpanLabel : `${cursor + 1}/${events.length}`}
      </span>

      {!selectedSpan && !atLive ? (
        <button
          type="button"
          onClick={onGoLive}
          className="shrink-0 text-[11px] px-2 py-1 rounded bg-accent text-white hover:bg-accent/90 cursor-pointer transition-colors"
          title="Jump to latest events"
        >
          Live +{behind}
        </button>
      ) : !selectedSpan && isActive && atLive ? (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
          LIVE
        </span>
      ) : null}
    </div>
  );
}
