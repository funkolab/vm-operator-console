import { useId } from "react";
import { cn } from "@/lib/utils";

/** Tiny dependency-free sparkline (area + line) for tables and tiles. */
export function Sparkline({
  values,
  className,
  max,
  color = "var(--chart-1)",
  height = 28,
  width = 96,
}: {
  values: number[];
  className?: string;
  max?: number;
  color?: string;
  height?: number;
  width?: number;
}) {
  const id = useId();
  if (values.length < 2) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const top = Math.max(max ?? 0, ...values, 1);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - (Math.max(0, v) / top) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible", className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)?.[0]} cy={pts.at(-1)?.[1]} r="2" fill={color} />
    </svg>
  );
}

export function usageTone(pct?: number) {
  if (pct === undefined) return "var(--muted-foreground)";
  if (pct >= 90) return "var(--destructive)";
  if (pct >= 75) return "var(--warning)";
  return "var(--success)";
}

/** Horizontal usage bar with threshold coloring. */
export function UsageBar({ value, className, color }: { value?: number; className?: string; color?: string }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={cn("bg-muted h-1.5 w-full overflow-hidden rounded-full", className)}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color ?? usageTone(value) }} />
    </div>
  );
}

/** Circular gauge for a single percentage. */
export function Gauge({ value, size = 64, stroke = 6, label, color }: { value?: number; size?: number; stroke?: number; label?: string; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? usageTone(value)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="tabular absolute text-[13px] font-semibold">{value === undefined ? "—" : `${Math.round(value)}%`}</span>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
