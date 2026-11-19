import { formatBytes, METRIC_RANGE_KEYS, METRIC_RANGES, type MetricPoint, type MetricRange } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Gauge as GaugeIcon, HardDrive, MemoryStick, Network, PowerOff } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usageTone } from "@/components/charts";
import { EmptyState, Section } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { vmMetricsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--popover-foreground)",
  fontSize: 12,
  boxShadow: "var(--elevation-2)",
};

const timeFmt = (range: MetricRange) => (t: string) => {
  const d = new Date(t);
  return range === "7d"
    ? d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })
    : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
};

const rate = (bps?: number) => (bps === undefined ? "—" : `${formatBytes(bps)}/s`);

function Kpi({ icon, label, value, sub, pct }: { icon: React.ReactNode; label: string; value: string; sub?: string; pct?: number }) {
  return (
    <div className="surface flex items-center gap-3 p-4">
      <div
        className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]"
        style={pct !== undefined ? { color: usageTone(pct) } : undefined}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="tabular truncate text-xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-muted-foreground truncate text-[11px]">{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  icon,
  data,
  range,
  series,
  unit,
  max,
  format,
}: {
  title: string;
  icon: React.ReactNode;
  data: MetricPoint[];
  range: MetricRange;
  series: { key: keyof MetricPoint; label: string; color: string }[];
  unit?: string;
  max?: number;
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ?? ""}`);
  const hasData = data.some((p) => series.some((s) => p[s.key] !== undefined));
  return (
    <Section title={title} icon={icon} bodyClassName="px-2 pt-4 pb-2 sm:px-3">
      <div className="mb-2 flex flex-wrap gap-3 px-2 text-xs">
        {series.map((s) => (
          <span key={String(s.key)} className="text-muted-foreground flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <div className="h-48">
        {hasData ? (
          <ResponsiveContainer>
            {series.length === 1 ? (
              <AreaChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id={`g-${String(series[0]?.key)}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={series[0]?.color} stopOpacity={0.3} />
                    <stop offset="1" stopColor={series[0]?.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={timeFmt(range)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis
                  width={48}
                  domain={[0, max ?? "auto"]}
                  tickFormatter={(v: number) => fmt(v)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(t) => new Date(String(t)).toLocaleString("en-US")}
                  formatter={(v) => [fmt(Number(v)), series[0]?.label]}
                />
                <Area
                  type="monotone"
                  dataKey={series[0]?.key as string}
                  stroke={series[0]?.color}
                  strokeWidth={2}
                  fill={`url(#g-${String(series[0]?.key)})`}
                  isAnimationActive={false}
                  connectNulls
                />
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={timeFmt(range)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                />
                <YAxis
                  width={56}
                  domain={[0, max ?? "auto"]}
                  tickFormatter={(v: number) => fmt(v)}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(t) => new Date(String(t)).toLocaleString("en-US")}
                  formatter={(v, n) => [fmt(Number(v)), series.find((s) => s.key === n)?.label ?? String(n)]}
                />
                {series.map((s) => (
                  <Line
                    key={String(s.key)}
                    type="monotone"
                    dataKey={s.key as string}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">No samples in this period</div>
        )}
      </div>
    </Section>
  );
}

/** Live performance of a VM, read from Prism Central stats. */
export function Monitoring({ ns, name, provisioned, poweredOn }: { ns: string; name: string; provisioned: boolean; poweredOn: boolean }) {
  const [range, setRange] = useState<MetricRange>("1h");
  const q = useQuery(vmMetricsQuery(ns, name, range, provisioned));
  if (!provisioned)
    return <EmptyState icon={<Activity className="size-6" />} title="Not provisioned yet" description="Metrics appear once the VM exists on Nutanix." />;
  const m = q.data;
  const c = m?.current ?? {};
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className={cn("size-2 rounded-full", m?.available ? "bg-success text-success animate-pulse-ring" : "bg-muted-foreground/50")} />
          {m?.available
            ? `Live from Prism Central · ${METRIC_RANGES[range].interval >= 60 ? `${METRIC_RANGES[range].interval / 60} min` : `${METRIC_RANGES[range].interval} s`} samples`
            : (m?.message ?? "Loading metrics…")}
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={range} onValueChange={(v) => v && setRange(v as MetricRange)}>
          {METRIC_RANGE_KEYS.map((r) => (
            <ToggleGroupItem key={r} value={r} className="px-3 text-xs" aria-label={METRIC_RANGES[r].label}>
              {r}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {!poweredOn && (
        <div className="text-muted-foreground bg-muted/50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
          <PowerOff className="size-4" /> The VM is powered off: recent samples may be empty.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Cpu />} label="CPU" value={c.cpu !== undefined ? `${c.cpu.toFixed(1)}%` : "—"} pct={c.cpu} />
        <Kpi
          icon={<MemoryStick />}
          label="Memory"
          value={c.mem !== undefined ? `${c.mem.toFixed(1)}%` : "—"}
          sub={c.guestMem !== undefined ? `Guest reports ${c.guestMem.toFixed(0)}%` : undefined}
          pct={c.mem}
        />
        <Kpi
          icon={<HardDrive />}
          label="Storage IOPS"
          value={c.iops !== undefined ? c.iops.toLocaleString() : "—"}
          sub={c.latencyMs !== undefined ? `${c.latencyMs} ms latency` : undefined}
        />
        <Kpi icon={<Network />} label="Network" value={`↓ ${rate(c.rxBps)}`} sub={`↑ ${rate(c.txBps)}`} />
      </div>
      {q.isLoading ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="CPU usage"
            icon={<Cpu />}
            data={m?.points ?? []}
            range={range}
            unit="%"
            max={100}
            series={[{ key: "cpu", label: "Hypervisor CPU", color: "var(--chart-1)" }]}
          />
          <ChartCard
            title="Memory usage"
            icon={<MemoryStick />}
            data={m?.points ?? []}
            range={range}
            unit="%"
            max={100}
            series={[
              { key: "mem", label: "Hypervisor", color: "var(--chart-4)" },
              { key: "guestMem", label: "Guest", color: "var(--chart-2)" },
            ]}
          />
          <ChartCard
            title="Storage"
            icon={<GaugeIcon />}
            data={m?.points ?? []}
            range={range}
            series={[
              { key: "readKBps", label: "Read KiB/s", color: "var(--chart-2)" },
              { key: "writeKBps", label: "Write KiB/s", color: "var(--chart-3)" },
            ]}
            format={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} M` : `${Math.round(v)} K`)}
          />
          <ChartCard
            title="Network throughput"
            icon={<Network />}
            data={m?.points ?? []}
            range={range}
            series={[
              { key: "rxBps", label: "Received", color: "var(--chart-1)" },
              { key: "txBps", label: "Transmitted", color: "var(--chart-5)" },
            ]}
            format={(v) => formatBytes(v, 0).replace(" ", "")}
          />
        </div>
      )}
    </div>
  );
}
