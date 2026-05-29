import { useCallback, useEffect, useState } from "react";
import type { PlanItem } from "../hooks/useApi";
import { fetchPlan } from "../hooks/useApi";
import { MarkdownContent } from "./MarkdownContent";

interface PlanViewProps {
  sessionId: string;
}

export function PlanView({ sessionId }: PlanViewProps) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlan(sessionId);
      setItems(data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-pulse text-sm text-gh-text-secondary">
          Loading plan...
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gh-text-secondary">
        No plan items for this session
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl space-y-3">
      {items.map((item, i) => (
        <PlanItemCard key={i} item={item} />
      ))}
    </div>
  );
}

function PlanItemCard({ item }: { item: PlanItem }) {
  const statusConfig = getStatusConfig(item.status);
  const priorityConfig = getPriorityConfig(item.priority);

  return (
    <div className="border border-gh-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gh-bg-sidebar border-b border-gh-border">
        <span className={`size-4 flex items-center justify-center ${statusConfig.color}`}>
          {statusConfig.icon}
        </span>
        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${statusConfig.badgeBg} ${statusConfig.color}`}>
          {item.status}
        </span>
        {item.priority && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${priorityConfig.bg} ${priorityConfig.color}`}>
            {item.priority}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <MarkdownContent content={item.content} />
      </div>
    </div>
  );
}

function getStatusConfig(status: string) {
  switch (status) {
    case "completed":
      return {
        icon: <CheckIcon />,
        color: "text-green-400",
        badgeBg: "bg-green-500/10",
      };
    case "in_progress":
      return {
        icon: <SpinnerIcon />,
        color: "text-blue-400",
        badgeBg: "bg-blue-500/10",
      };
    case "cancelled":
      return {
        icon: <XIcon />,
        color: "text-gh-text-secondary",
        badgeBg: "bg-gh-bg-hover",
      };
    default: // pending
      return {
        icon: <CircleIcon />,
        color: "text-yellow-400",
        badgeBg: "bg-yellow-500/10",
      };
  }
}

function getPriorityConfig(priority: string) {
  switch (priority) {
    case "high":
      return { color: "text-red-400", bg: "bg-red-500/10" };
    case "low":
      return { color: "text-gh-text-secondary", bg: "bg-gh-bg-hover" };
    default: // medium
      return { color: "text-gh-text-secondary", bg: "bg-gh-bg-hover" };
  }
}

function CheckIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="size-3.5 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="6" strokeOpacity="0.3" />
      <path d="M14 8a6 6 0 0 0-6-6" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="5.5" />
    </svg>
  );
}
