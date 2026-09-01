import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "./types";

export interface TimelineEvent {
  index: number;
  messageIndex: number;
  messageId: string;
  label: string;
  color: string;
  kind: string;
}

function buildEvents(messages: Message[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let idx = 0;
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    if (msg.role === "user") {
      events.push({
        index: idx++,
        messageIndex: mi,
        messageId: msg.id,
        label: msg.content.slice(0, 80) || "user",
        color: "#58a6ff",
        kind: "user-request",
      });
      continue;
    }
    if (msg.role === "assistant") {
      const tools = msg.toolCalls ?? [];
      if (tools.length > 0) {
        for (const t of tools) {
          if (t.name === "report_intent") continue;
          events.push({
            index: idx++,
            messageIndex: mi,
            messageId: msg.id,
            label: t.name,
            color: "#8b949e",
            kind: t.name,
          });
        }
      } else if (msg.reasoning) {
        events.push({
          index: idx++,
          messageIndex: mi,
          messageId: msg.id,
          label: "thinking",
          color: "#a78bfa",
          kind: "thinking",
        });
      } else if (msg.content?.trim()) {
        events.push({
          index: idx++,
          messageIndex: mi,
          messageId: msg.id,
          label: msg.content.slice(0, 80),
          color: "#8b949e",
          kind: "assistant-text",
        });
      } else {
        events.push({
          index: idx++,
          messageIndex: mi,
          messageId: msg.id,
          label: "assistant",
          color: "#8b949e",
          kind: "assistant",
        });
      }
    }
  }
  return events;
}

export interface UseTimelineOptions {
  messages: Message[];
  isActive: boolean;
}

export function useTimeline({ messages, isActive }: UseTimelineOptions) {
  const events = useMemo(() => buildEvents(messages), [messages]);
  const maxIndex = events.length > 0 ? events.length - 1 : 0;
  const [cursor, setCursor] = useState<number>(() => maxIndex);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const isScrubbingRef = useRef(false);
  const wasAtLiveRef = useRef(true);

  useLayoutEffect(() => {
    const newMax = events.length > 0 ? events.length - 1 : 0;
    if (wasAtLiveRef.current || !isScrubbingRef.current) {
      setCursor(newMax);
    } else {
      setCursor((c) => Math.min(c, newMax));
    }
    if (events.length === 0) wasAtLiveRef.current = true;
  }, [events.length]);

  useLayoutEffect(() => {
    wasAtLiveRef.current = cursor >= maxIndex;
  }, [cursor, maxIndex]);

  useEffect(() => {
    if (!playing || events.length === 0) return;
    const baseMs = 600;
    const interval = Math.max(120, baseMs / speed);
    const id = setInterval(() => {
      setCursor((c) => {
        if (c >= maxIndex) {
          setPlaying(false);
          if (isActive) wasAtLiveRef.current = true;
          return c;
        }
        return c + 1;
      });
    }, interval);
    return () => clearInterval(id);
  }, [playing, maxIndex, speed, events.length, isActive]);

  useLayoutEffect(() => {
    if (!isActive || !wasAtLiveRef.current || isScrubbingRef.current || playing) return;
    if (cursor !== maxIndex) setCursor(maxIndex);
  }, [maxIndex, isActive, cursor, playing]);

  const setCursorScrub = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, maxIndex));
      isScrubbingRef.current = true;
      setCursor(clamped);
      wasAtLiveRef.current = clamped >= maxIndex;
      setPlaying(false);
    },
    [maxIndex],
  );

  const endScrub = useCallback(() => {
    isScrubbingRef.current = false;
  }, []);

  const goLive = useCallback(() => {
    wasAtLiveRef.current = true;
    isScrubbingRef.current = false;
    setCursor(maxIndex);
    setPlaying(false);
  }, [maxIndex]);

  const atLive = cursor >= maxIndex;
  const behind = atLive ? 0 : maxIndex - cursor;

  return {
    events,
    maxIndex,
    cursor,
    setCursor: setCursorScrub,
    endScrub,
    playing,
    setPlaying,
    speed,
    setSpeed,
    atLive,
    behind,
    goLive,
    step: useCallback((delta: number) => setCursorScrub(cursor + delta), [cursor, setCursorScrub]),
  };
}
