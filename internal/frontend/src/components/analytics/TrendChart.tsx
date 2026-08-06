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
          domain={yDomain}
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
