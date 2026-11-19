import { formatBytes, getCondition, type InfraHost, type InfraVM } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, Cpu, Eye, EyeOff, Map as MapIcon, MemoryStick, RefreshCw, Search, ServerCog } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Gauge, UsageBar } from "@/components/charts";
import { EmptyState, ErrorState, Page, PageHeader } from "@/components/page";
import { PHASE_STYLE } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/format";
import { useNamespace } from "@/lib/namespace";
import { contextsQuery, infrastructureQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/infrastructure")({
  validateSearch: z.object({ ctx: z.string().optional(), all: z.boolean().optional().catch(undefined) }),
  component: InfrastructurePage,
});

function VMChip({ vm, dim }: { vm: InfraVM; dim: boolean }) {
  const on = vm.powerState === "ON";
  const content = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all",
        vm.managed
          ? "bg-primary/8 border-primary/30 text-foreground hover:border-primary/60 hover:bg-primary/12 font-medium"
          : "bg-muted/60 text-muted-foreground",
        dim && "opacity-25",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          vm.managed?.phase ? PHASE_STYLE[vm.managed.phase as keyof typeof PHASE_STYLE]?.dot : on ? "bg-success/70" : "bg-muted-foreground/40",
        )}
      />
      <span className="truncate">{vm.managed?.displayName ?? vm.nutanixName}</span>
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {vm.managed ? (
          <Link to="/vms/$ns/$name" params={{ ns: vm.managed.namespace, name: vm.managed.name }} className="max-w-full">
            {content}
          </Link>
        ) : (
          content
        )}
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{vm.nutanixName}</div>
        <div className="text-xs opacity-80">
          {vm.managed ? `Managed by vm-operator · ${vm.managed.namespace}/${vm.managed.name} · ${vm.managed.phase}` : "Not managed by vm-operator"} ·{" "}
          {on ? "on" : "off"}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function HostCard({ h, filter, showUnmanaged }: { h: InfraHost; filter: string; showUnmanaged: boolean }) {
  const vms = h.vms.filter((v) => showUnmanaged || v.managed);
  const managed = h.vms.filter((v) => v.managed).length;
  const match = (v: InfraVM) => !filter || `${v.nutanixName} ${v.managed?.name ?? ""} ${v.managed?.namespace ?? ""}`.toLowerCase().includes(filter);
  return (
    <div className="surface flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ServerCog className="text-muted-foreground size-4" />
            <span className="truncate font-semibold">{h.name ?? h.extId}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {h.cores ? `${h.cores} cores` : ""}
            {h.memoryBytes ? ` · ${formatBytes(h.memoryBytes, 0)}` : ""}
            {h.cpuModel
              ? ` · ${h.cpuModel
                  .replace(/\(R\)|\(TM\)|CPU|Intel|@.*/g, "")
                  .replace(/\s+/g, " ")
                  .trim()}`
              : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-sm font-semibold">{h.vms.length}</div>
          <div className="text-muted-foreground text-[11px]">{managed ? `${managed} managed` : "VMs"}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 px-4 pt-3">
        {[
          { label: "CPU", icon: <Cpu className="size-3" />, v: h.cpuUsage },
          { label: "Memory", icon: <MemoryStick className="size-3" />, v: h.memUsage },
        ].map((m) => (
          <div key={m.label}>
            <div className="text-muted-foreground flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1">
                {m.icon} {m.label}
              </span>
              <span className="tabular text-foreground font-medium">{m.v !== undefined ? `${m.v.toFixed(0)}%` : "—"}</span>
            </div>
            <UsageBar value={m.v} className="mt-1" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap content-start gap-1.5 p-4">
        {vms.length === 0 ? (
          <span className="text-muted-foreground text-xs">{h.vms.length ? "Only unmanaged VMs on this host" : "No VM"}</span>
        ) : (
          vms.map((v) => <VMChip key={v.extId} vm={v} dim={!match(v)} />)
        )}
      </div>
    </div>
  );
}

function InfrastructurePage() {
  const scope = useNamespace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ctxs = useQuery(contextsQuery(scope));
  const connected = (ctxs.data ?? []).filter((c) => getCondition(c.status?.conditions, "Connected")?.status === "True");
  const selected = connected.find((c) => `${c.metadata.namespace}/${c.metadata.name}` === search.ctx) ?? connected[0];
  const ns = selected?.metadata.namespace as string | undefined;
  const name = selected?.metadata.name as string | undefined;
  const q = useQuery({ ...infrastructureQuery(ns ?? "", name ?? ""), enabled: !!selected });
  const [filter, setFilter] = useState("");
  const showUnmanaged = search.all ?? true;
  const f = filter.trim().toLowerCase();
  const data = q.data;
  const totals = useMemo(() => {
    const hosts = data?.clusters.flatMap((c) => c.hosts) ?? [];
    return { hosts: hosts.length, vms: data?.totalVms ?? 0, managed: data?.managedCount ?? 0 };
  }, [data]);

  return (
    <Page>
      <PageHeader
        icon={<MapIcon className="size-5" />}
        eyebrow="Live from Prism Central"
        title="Infrastructure"
        description="Where your VMs actually run: clusters, hosts and live utilization. VMs managed by vm-operator are highlighted."
        actions={
          <>
            {connected.length > 1 && (
              <Select
                value={selected ? `${selected.metadata.namespace}/${selected.metadata.name}` : undefined}
                onValueChange={(v) => navigate({ search: { ...search, ctx: v }, replace: true })}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Prism Central" />
                </SelectTrigger>
                <SelectContent>
                  {connected.map((c) => (
                    <SelectItem key={`${c.metadata.namespace}/${c.metadata.name}`} value={`${c.metadata.namespace}/${c.metadata.name}`}>
                      {c.metadata.name} <span className="text-muted-foreground">· {c.spec.endpoint.address}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn(q.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />
      {ctxs.isLoading ? (
        <Skeleton className="h-64" />
      ) : !selected ? (
        <EmptyState
          icon={<ServerCog className="size-6" />}
          title="No connected Prism Central"
          description="Add a Prism Central account in a namespace you can access to explore its infrastructure."
          action={
            <Button asChild>
              <Link to="/contexts/new">Add Prism Central</Link>
            </Button>
          }
        />
      ) : q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !data?.available ? (
        <ErrorState error={new Error(data?.message ?? "Infrastructure unavailable")} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-80">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Highlight a VM…" className="h-9 pl-8" />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={() => navigate({ search: { ...search, all: !showUnmanaged }, replace: true })}>
              {showUnmanaged ? <EyeOff /> : <Eye />} {showUnmanaged ? "Hide unmanaged VMs" : "Show unmanaged VMs"}
            </Button>
            <div className="text-muted-foreground ml-auto flex flex-wrap items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="bg-primary/15 border-primary/40 size-3 rounded border" /> Managed by vm-operator
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-muted size-3 rounded border" /> Other VMs
              </span>
              <span>Updated {relativeTime(data.generatedAt)}</span>
            </div>
          </div>
          {data.clusters.map((c) => {
            const memPct = c.memoryCapacityBytes && c.memoryUsedBytes ? (c.memoryUsedBytes / c.memoryCapacityBytes) * 100 : c.memUsage;
            const storPct = c.storageCapacityBytes && c.storageUsedBytes ? (c.storageUsedBytes / c.storageCapacityBytes) * 100 : undefined;
            return (
              <section key={c.extId} className="flex flex-col gap-4">
                <div className="surface bg-hero flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
                      <Boxes className="size-5" />
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">Cluster</div>
                      <div className="text-xl font-semibold tracking-tight">{c.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {c.nodes} hosts · {c.hosts.reduce((a, h) => a + h.vms.length, 0) + c.unplaced.length} VMs · {c.vcpusConfigured ?? "—"} vCPU configured
                        {c.cpuOvercommit ? ` (${c.cpuOvercommit}×)` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-6">
                    {[
                      { label: "CPU", v: c.cpuUsage, sub: undefined },
                      { label: "Memory", v: memPct, sub: `${formatBytes(c.memoryUsedBytes, 0)} / ${formatBytes(c.memoryCapacityBytes, 0)}` },
                      { label: "Storage", v: storPct, sub: `${formatBytes(c.storageUsedBytes, 1)} / ${formatBytes(c.storageCapacityBytes, 1)}` },
                    ].map((g) => (
                      <div key={g.label} className="flex items-center gap-2.5">
                        <Gauge value={g.v} size={52} stroke={5} />
                        <div>
                          <div className="text-sm font-medium">{g.label}</div>
                          {g.sub && <div className="text-muted-foreground tabular text-[11px]">{g.sub}</div>}
                        </div>
                      </div>
                    ))}
                    <div className="text-sm">
                      <div className="tabular font-medium">{c.iops?.toLocaleString() ?? "—"} IOPS</div>
                      <div className="text-muted-foreground text-[11px]">{c.latencyMs !== undefined ? `${c.latencyMs} ms avg latency` : ""}</div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                  {c.hosts.map((h) => (
                    <HostCard key={h.extId} h={h} filter={f} showUnmanaged={showUnmanaged} />
                  ))}
                </div>
                {c.unplaced.filter((v) => showUnmanaged || v.managed).length > 0 && (
                  <div className="surface p-4">
                    <div className="text-muted-foreground mb-2 text-xs font-medium">Powered off (not placed on a host)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.unplaced
                        .filter((v) => showUnmanaged || v.managed)
                        .map((v) => (
                          <VMChip key={v.extId} vm={v} dim={!!f && !`${v.nutanixName} ${v.managed?.name ?? ""}`.toLowerCase().includes(f)} />
                        ))}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-muted-foreground text-xs">
            {totals.hosts} hosts · {totals.vms} VMs on Prism Central, {totals.managed} managed by vm-operator in namespaces you can access.
          </p>
        </>
      )}
    </Page>
  );
}
