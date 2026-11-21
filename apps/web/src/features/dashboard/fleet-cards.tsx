import { formatBytes, type InfraCluster, VM_PHASES, type VMPhase, type VMSummary } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Cpu, Flame, MemoryStick, ServerCog } from "lucide-react";
import { Gauge, Sparkline, UsageBar, usageTone } from "@/components/charts";
import { Section } from "@/components/page";
import { PHASE_STYLE } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceLabel } from "@/lib/namespace";
import { infrastructureQuery, topConsumersQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Segmented bar of VM phases with a legend. */
export function PhaseBreakdown({ summaries }: { summaries: VMSummary[] }) {
  const total = summaries.length;
  const counts = new Map<VMPhase, number>();
  for (const s of summaries) counts.set(s.phase, (counts.get(s.phase) ?? 0) + 1);
  const phases = VM_PHASES.filter((p) => counts.get(p));
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted flex h-2.5 overflow-hidden rounded-full">
        {phases.map((p) => (
          <Tooltip key={p}>
            <TooltipTrigger asChild>
              <div
                className={cn("h-full first:rounded-l-full last:rounded-r-full", PHASE_STYLE[p].dot)}
                style={{ width: `${((counts.get(p) ?? 0) / total) * 100}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {p}: {counts.get(p)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {phases.map((p) => (
          <Link key={p} to="/vms" className="group flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", PHASE_STYLE[p].dot)} />
            <span className="text-muted-foreground group-hover:text-foreground transition-colors">{p}</span>
            <span className="tabular ml-auto font-medium">{counts.get(p)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ClusterCard({ c }: { c: InfraCluster }) {
  const memPct = c.memoryCapacityBytes && c.memoryUsedBytes ? (c.memoryUsedBytes / c.memoryCapacityBytes) * 100 : c.memUsage;
  const storPct = c.storageCapacityBytes && c.storageUsedBytes ? (c.storageUsedBytes / c.storageCapacityBytes) * 100 : undefined;
  return (
    <div className="bg-background/50 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.name}</div>
          <div className="text-muted-foreground text-xs">
            {c.nodes} nodes · {c.hosts.reduce((a, h) => a + h.vms.length, 0) + c.unplaced.length} VMs
            {c.cpuOvercommit ? ` · ${c.cpuOvercommit}× vCPU overcommit` : ""}
          </div>
        </div>
        {c.healthScore !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset",
                  c.healthScore >= 80
                    ? "bg-success/10 text-success ring-success/25"
                    : c.healthScore >= 50
                      ? "bg-warning/12 text-warning ring-warning/30"
                      : "bg-destructive/10 text-destructive ring-destructive/25",
                )}
              >
                Health {c.healthScore}
              </span>
            </TooltipTrigger>
            <TooltipContent>Prism Central NCC health score</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex gap-5">
          {[
            { label: "CPU", v: c.cpuUsage },
            { label: "Memory", v: memPct },
            { label: "Storage", v: storPct },
          ].map((g) => (
            <div key={g.label} className="flex flex-col items-center gap-1">
              <Gauge value={g.v} size={60} stroke={5} label={g.label} />
              <span className="text-muted-foreground text-[11px]">{g.label}</span>
            </div>
          ))}
        </div>
        <dl className="text-muted-foreground grid min-w-56 flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt>Memory</dt>
          <dd className="tabular text-foreground text-right">
            {formatBytes(c.memoryUsedBytes)} / {formatBytes(c.memoryCapacityBytes)}
          </dd>
          <dt>Storage</dt>
          <dd className="tabular text-foreground text-right">
            {formatBytes(c.storageUsedBytes, 1)} / {formatBytes(c.storageCapacityBytes, 1)}
          </dd>
          <dt>vCPU configured</dt>
          <dd className="tabular text-foreground text-right">{c.vcpusConfigured ?? "—"}</dd>
          <dt>IOPS · latency</dt>
          <dd className="tabular text-foreground text-right">
            {c.iops?.toLocaleString() ?? "—"} · {c.latencyMs !== undefined ? `${c.latencyMs} ms` : "—"}
          </dd>
        </dl>
      </div>
    </div>
  );
}

/** Live capacity of the clusters behind the first connected Prism Central context. */
export function ClusterCapacity({ context }: { context?: { namespace: string; name: string } }) {
  const q = useQuery({ ...infrastructureQuery(context?.namespace ?? "", context?.name ?? ""), enabled: !!context });
  return (
    <Section
      title="Cluster capacity"
      icon={<ServerCog />}
      description={context ? `Live from Prism Central · ${context.name}` : "Connect a Prism Central to see live capacity"}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link to="/infrastructure">
            Infrastructure map <ArrowRight />
          </Link>
        </Button>
      }
    >
      {!context ? (
        <p className="text-muted-foreground text-sm">No connected Prism Central context in scope.</p>
      ) : q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : !q.data?.available ? (
        <p className="text-muted-foreground text-sm">Capacity unavailable{q.data?.message ? `: ${q.data.message}` : ""}</p>
      ) : (
        <div className={cn("grid gap-3", q.data.clusters.length > 1 && "md:grid-cols-2")}>
          {q.data.clusters.map((c) => (
            <ClusterCard key={c.extId} c={c} />
          ))}
        </div>
      )}
    </Section>
  );
}

/** VMs ranked by live CPU usage, with a sparkline of the last 30 minutes. */
export function TopConsumers({ scope }: { scope: string }) {
  const wsLabel = useWorkspaceLabel();
  const q = useQuery(topConsumersQuery(scope));
  const items = q.data?.items ?? [];
  return (
    <Section title="Top consumers" icon={<Flame />} description="Running VMs by CPU · live from Prism Central" bodyClassName="p-0 sm:p-0">
      {q.isLoading ? (
        <div className="grid gap-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground p-5 text-sm">{q.data?.message ?? "No running VM to measure."}</p>
      ) : (
        <ul className="divide-y">
          {items.map((v) => (
            <li key={`${v.namespace}/${v.name}`}>
              <Link
                to="/vms/$ns/$name"
                params={{ ns: v.namespace, name: v.name }}
                search={{ tab: "monitoring" }}
                className="hover:bg-accent/50 grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-2.5 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{v.displayName}</span>
                  <span className="text-muted-foreground block truncate text-xs">{wsLabel(v.namespace)}</span>
                </span>
                <Sparkline values={v.spark} max={100} color={usageTone(v.cpu)} width={84} height={24} />
                <span className="w-28">
                  <span className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Cpu className="size-3" /> CPU
                    </span>
                    <span className="tabular font-medium">{v.cpu?.toFixed(1) ?? "—"}%</span>
                  </span>
                  <UsageBar value={v.cpu} className="mt-1" />
                  <span className="text-muted-foreground mt-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1">
                      <MemoryStick className="size-3" /> Mem
                    </span>
                    <span className="tabular">{v.mem?.toFixed(0) ?? "—"}%</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
