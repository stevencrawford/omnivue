interface StatCardProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
  sub?: string;
}

export function StatCard({ icon: Icon, label, value, sub }: StatCardProps) {
  return (
    <div className="sess-overview-stat">
      <div className="sess-overview-stat-icon">
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-widest text-ov-text-secondary">{label}</p>
        <p className="text-lg font-semibold tabular-nums truncate">{value}</p>
        {sub && (
          <p className="text-[11px] text-ov-text-secondary truncate" title={sub}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
