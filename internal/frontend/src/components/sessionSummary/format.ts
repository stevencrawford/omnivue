export function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`;
}

export function formatPct(value: number): string {
  if (value === 0) return "\u2014";
  if (value >= 99.95) return "100%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}

export function formatSmallPct(value: number | null): string {
  if (value === null || value === 0) return "\u2014";
  if (value >= 99.95) return "100%";
  if (value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
}
