import { useCallback, useRef } from "react";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import type { TimelineEvent } from "../../hooks/useTimeline";

interface TimelineScrubberProps {
  events: TimelineEvent[];
  cursor: number;
  maxIndex: number;
  playing: boolean;
  onCursorChange: (next: number) => void;
  onEndScrub: () => void;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onGoLive: () => void;
  atLive: boolean;
  behind: number;
  isActive: boolean;
}

export function TimelineScrubber({
  events,
  cursor,
  maxIndex,
  playing,
  onCursorChange,
  onEndScrub,
  onTogglePlay,
  onStep,
  onGoLive,
  atLive,
  behind,
  isActive,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pct = maxIndex > 0 ? (cursor / maxIndex) * 100 : 0;

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
      draggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
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
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      onEndScrub();
    },
    [onEndScrub],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      updateFromClientX(e.clientX);
      onEndScrub();
    },
    [updateFromClientX, onEndScrub],
  );

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-ov-border bg-ov-bg-secondary text-xs text-ov-text-secondary shrink-0">
        <span>No timeline events yet</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-ov-border bg-ov-bg-secondary shrink-0"
      aria-label="Session timeline"
    >
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={cursor <= 0}
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
        onClick={() => onStep(1)}
        disabled={cursor >= maxIndex}
        className="size-6 flex items-center justify-center rounded text-ov-text-secondary hover:text-ov-text hover:bg-ov-bg-hover disabled:opacity-30 cursor-pointer transition-colors"
        title="Next event (→)"
        aria-label="Next event"
      >
        <SkipForward size={14} />
      </button>

      <div
        ref={trackRef}
        className="relative flex-1 h-6 flex items-center cursor-pointer select-none"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={maxIndex}
        aria-valuenow={cursor}
        aria-label="Timeline position"
        onClick={handleTrackClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 bg-ov-border rounded-full overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-accent rounded-full transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        {events.map((ev) => {
          const left = maxIndex > 0 ? (ev.index / maxIndex) * 100 : 0;
          const isPast = ev.index <= cursor;
          return (
            <div
              key={ev.index}
              className="absolute top-1/2 -translate-y-1/2 w-1 h-3 rounded-full -ml-0.5 pointer-events-none"
              style={{
                left: `${left}%`,
                backgroundColor: ev.color,
                opacity: isPast ? 1 : 0.25,
              }}
              title={`${ev.kind}: ${ev.label.slice(0, 80)}`}
            />
          );
        })}
        <div
          className="absolute top-1/2 -translate-y-1/2 size-3 rounded-full bg-ov-bg border-2 border-accent shadow-sm -ml-1.5 pointer-events-none"
          style={{ left: `${pct}%` }}
        />
      </div>

      <span className="text-[11px] font-mono text-ov-text-secondary tabular-nums shrink-0">
        {cursor + 1}/{events.length}
      </span>

      {!atLive && (
        <button
          type="button"
          onClick={onGoLive}
          className="shrink-0 text-[11px] px-2 py-1 rounded bg-accent text-white hover:bg-accent/90 cursor-pointer transition-colors"
          title="Jump to latest events"
        >
          Live +{behind}
        </button>
      )}
      {atLive && isActive && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
          LIVE
        </span>
      )}
    </div>
  );
}
