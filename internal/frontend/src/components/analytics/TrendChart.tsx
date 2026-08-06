import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendLine {
  key: string;
  name: string;
  color: string;
}

interface TrendChartProps<T extends { date: string }> {
  data: T[];
  lines: TrendLine[];
  yFormatter?: (value: number) => string;
  height?: number;
  yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"];
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// autoDomain derives a min/max-based y domain so low-magnitude series (like a
// percent failure rate) are not flattened onto a 0-100 axis. Returns undefined
// when the data has no variation worth exaggerating, letting the chart fall back
// to a standard zero-based axis.
function autoDomain<T extends { date: string }>(
  data: T[],
  lines: TrendLine[],
): [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    for (const l of lines) {
      const v = (d as Record<string, unknown>)[l.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  const range = max - min;
  if (max === 0 || range <= max * 0.02) return undefined;
  const pad = range * 0.15;
  return [Math.max(0, min - pad), max + pad];
}

// TrendChart renders a small multi-line time series over date-keyed data. It is
// deliberately chart-only: the analytics tab owns titles, layouts, and empty
// states so this stays a reusable primitive.
export function TrendChart<T extends { date: string }>({
  data,
  lines,
  yFormatter,
  height = 200,
  yDomain,
}: TrendChartProps<T>) {
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0].payload;
    return (
      <div className="ov-chart-tooltip">
        <p className="ov-chart-tooltip-date">{formatDayLabel(entry.date)}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="ov-chart-tooltip-row">
            <span className="ov-chart-tooltip-swatch" style={{ background: p.color }} />
            <span>{p.name}</span>
            <span className="ml-auto tabular-nums">
              {yFormatter ? yFormatter(Number(p.value)) : String(p.value ?? "")}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const domain = yDomain ?? autoDomain(data, lines);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ov-border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDayLabel}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--color-ov-text-secondary)" }}
          tickLine={false}
          axisLine={false}
          width={48}
          domain={domain}
          tickFormatter={(v: number) => (yFormatter ? yFormatter(v) : String(v))}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--color-ov-border)" }} />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
