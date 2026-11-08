import type { DashboardStats } from "@console/shared";
import { formatBytes } from "@console/shared";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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

function Share({ value, total, label, color }: { value: number; total: number; label: string; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5" title={`${label} · ${pct}% of the total`}>
      <span className="tabular w-16 shrink-0 text-right">{label}</span>
      <div className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function Charts({ stats }: { stats: DashboardStats }) {
  const phases = Object.entries(stats.vms.byPhase)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const clusters = stats.byCluster.slice(0, 10);
  const totals = stats.byCluster.reduce((t, c) => ({ vcpus: t.vcpus + c.vcpus, memoryBytes: t.memoryBytes + c.memoryBytes }), { vcpus: 0, memoryBytes: 0 });
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
      <Section title="Allocation by cluster" description="Declared by VMs · bars show the share of the total">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-14" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="pb-2 font-medium">Cluster</th>
              <th className="pb-2 pl-3 text-right font-medium">VMs</th>
              <th className="pb-2 pl-4 font-medium">vCPU</th>
              <th className="pb-2 pl-4 font-medium">Memory</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.cluster} className="border-t">
                <td className="truncate py-2.5 font-medium" title={c.cluster}>
                  {c.cluster}
                </td>
                <td className="tabular py-2.5 pl-3 text-right">{c.count}</td>
                <td className="py-2.5 pl-4">
                  <Share value={c.vcpus} total={totals.vcpus} label={String(c.vcpus)} color="var(--chart-1)" />
                </td>
                <td className="py-2.5 pl-4">
                  <Share value={c.memoryBytes} total={totals.memoryBytes} label={formatBytes(c.memoryBytes, 0)} color="var(--chart-3)" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats.byCluster.length > clusters.length && (
          <p className="text-muted-foreground mt-2 text-xs">+ {stats.byCluster.length - clusters.length} more clusters</p>
        )}
      </Section>
    </div>
  );
}
