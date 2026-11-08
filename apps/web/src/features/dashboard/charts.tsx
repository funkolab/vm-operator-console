import type { DashboardStats } from "@console/shared";
import { formatBytes } from "@console/shared";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Section } from "@/components/page";

const PHASE_COLOR: Record<string, string> = {
  Running: "var(--success)",
  Stopped: "var(--muted-foreground)",
  Error: "var(--destructive)",
  Degraded: "var(--warning)",
  Provisioning: "var(--info)",
  Starting: "var(--info)",
  Stopping: "var(--warning)",
  Pending: "var(--chart-4)",
  Deleting: "var(--destructive)",
  Updating: "var(--info)",
  Restarting: "var(--info)",
  Unknown: "var(--border)",
};

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export default function Charts({ stats }: { stats: DashboardStats }) {
  const phases = Object.entries(stats.vms.byPhase)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const clusters = stats.byCluster.slice(0, 10).map((c) => ({ ...c, memoryGiB: Math.round(c.memoryBytes / 2 ** 30) }));
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Section title="VMs by status">
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-52 w-52 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={phases} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2} stroke="var(--card)">
                  {phases.map((p) => (
                    <Cell key={p.name} fill={PHASE_COLOR[p.name] ?? "var(--chart-1)"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="grid w-full gap-1.5">
            {phases.map((p) => (
              <li key={p.name} className="flex items-center gap-2 text-sm">
                <span className="size-2.5 rounded-sm" style={{ background: PHASE_COLOR[p.name] }} />
                {p.name}
                <span className="text-muted-foreground tabular ml-auto">{p.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <Section title="Allocation by cluster" description="vCPU and memory (GiB) declared by VMs">
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={clusters} margin={{ left: -16, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="cluster" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--accent)" }}
                formatter={(v, n) => (n === "memoryGiB" ? [formatBytes(Number(v) * 2 ** 30), "Memory"] : [v, n === "vcpus" ? "vCPU" : "VMs"])}
              />
              <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="vcpus" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="memoryGiB" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
