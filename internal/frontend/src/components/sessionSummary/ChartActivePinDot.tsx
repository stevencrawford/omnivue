import type { TokenTimelinePoint } from "../../hooks/useSessionTokenomics";

interface ChartActiveDotProps {
  cx?: number;
  cy?: number;
  r?: number | string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number | string;
  payload?: TokenTimelinePoint;
  onNavigateToMessage?: (messageIndex: number, messageId?: string) => void;
}

function toNum(v: number | string | undefined): number | undefined {
  return typeof v === "string" ? Number(v) : v;
}

export function ChartActivePinDot({
  cx,
  cy,
  r,
  fill,
  stroke,
  strokeWidth,
  payload,
  onNavigateToMessage,
}: ChartActiveDotProps) {
  const x = toNum(cx);
  const y = toNum(cy);
  if (x === undefined || y === undefined) return null;
  const navigable = payload?.messageIndex !== undefined || payload?.messageId !== undefined;
  return (
    <circle
      cx={x}
      cy={y}
      r={toNum(r) ?? 4}
      fill={fill ?? "var(--color-accent)"}
      stroke={stroke ?? "var(--color-surface)"}
      strokeWidth={toNum(strokeWidth) ?? 2}
      className={onNavigateToMessage && navigable ? "cursor-pointer" : "cursor-default"}
      onClick={
        onNavigateToMessage && navigable
          ? () => onNavigateToMessage(payload!.messageIndex!, payload!.messageId)
          : undefined
      }
    />
  );
}
