interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  subtext?: string;
  accent?: "default" | "terracotta";
  className?: string;
}

export function KpiCard({
  label,
  value,
  unit,
  subtext,
  accent = "default",
  className = "",
}: KpiCardProps) {
  const valueColor =
    accent === "terracotta" ? "text-terracotta-500" : "text-ink-900";

  return (
    <div
      className={`bg-white border border-[color:var(--border-subtle)] rounded-lg p-6 md:p-7 flex flex-col gap-2 ${className}`}
    >
      <span className="font-sans font-semibold text-[10px] uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <div className="flex items-baseline gap-[6px]">
        <span
          className={`font-display font-medium tabular-nums leading-none text-[26px] md:text-[30px] ${valueColor}`}
        >
          {value}
        </span>
        {unit && <span className="text-[12px] text-ink-500">{unit}</span>}
      </div>
      {subtext && (
        <span className="text-[12px] text-ink-500">{subtext}</span>
      )}
    </div>
  );
}
