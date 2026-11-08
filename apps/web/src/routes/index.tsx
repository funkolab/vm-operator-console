import { formatBytes } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Cpu,
  HardDrive,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  MemoryStick,
  Network,
  Plus,
  Power,
  Server,
  ServerCog,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventList } from "@/features/events/event-list";
import { ALL, useNamespace } from "@/lib/namespace";
import { eventsQuery, statsQuery, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const Charts = lazy(() => import("@/features/dashboard/charts"));

export const Route = createFileRoute("/")({ component: Dashboard });

function Kpi({
  icon,
  label,
  value,
  sub,
  to,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  to?: string;
  tone?: "warning" | "danger" | "success";
}) {
  const body = (
    <div className="bg-card hover:border-primary/30 flex h-full items-start gap-3 rounded-xl border p-4 transition-colors">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          tone === "warning"
            ? "bg-warning/15 text-warning"
            : tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : tone === "success"
                ? "bg-success/12 text-success"
                : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div className="tabular text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function Dashboard() {
  const ns = useNamespace();
  const me = useMe();
  const q = useQuery(statsQuery(ns));
  const events = useQuery(eventsQuery(ns));
  const s = q.data;
  return (
    <Page>
      <PageHeader
        icon={<LayoutDashboard className="size-5" />}
        title={`Welcome, ${me.data?.user ?? ""}`}
        description={ns === ALL ? `Overview of ${me.data?.namespaces.length ?? 0} namespace(s) you can access` : `Overview of namespace ${ns}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/templates">
                <LayoutTemplate /> Deploy from template
              </Link>
            </Button>
            <Button asChild>
              <Link to="/vms/new">
                <Plus /> Create VM
              </Link>
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <LoadingState rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={<Server className="size-5" />}
              label="Virtual machines"
              value={s.vms.total}
              sub={`${s.vms.on} running · ${s.vms.off} stopped`}
              to="/vms"
            />
            <Kpi
              icon={<Power className="size-5" />}
              label="Healthy"
              value={`${s.vms.ready}/${s.vms.total}`}
              sub={s.vms.activeTasks ? `${s.vms.activeTasks} operation(s) in progress` : "No operation in progress"}
              tone={s.vms.notReady ? "warning" : "success"}
              to="/vms"
            />
            <Kpi
              icon={<ServerCog className="size-5" />}
              label="Prism Central"
              value={`${s.contexts.connected}/${s.contexts.total}`}
              sub="connected contexts"
              tone={s.contexts.disconnected ? "danger" : "success"}
              to="/contexts"
            />
            <Kpi
              icon={<Network className="size-5" />}
              label="VM services"
              value={s.services.total}
              sub={`${s.services.readyEndpoints}/${s.services.selectedVms} endpoints ready`}
              to="/services"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi icon={<Cpu className="size-5" />} label="Allocated vCPU" value={s.capacity.vcpus} />
            <Kpi icon={<MemoryStick className="size-5" />} label="Allocated memory" value={formatBytes(s.capacity.memoryBytes)} />
            <Kpi icon={<HardDrive className="size-5" />} label="Provisioned storage" value={formatBytes(s.capacity.diskBytes)} />
          </div>
          {s.vms.total === 0 ? (
            <EmptyState
              icon={<Server className="size-6" />}
              title="No virtual machines yet"
              description="Start by adding a Prism Central account, then create a VM or a template."
              action={
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <Link to="/contexts/new">Add Prism Central</Link>
                  </Button>
                  <Button asChild>
                    <Link to="/vms/new">Create VM</Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <Charts stats={s} />
            </Suspense>
          )}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title={
                <span className="flex items-center gap-2">
                  Needs attention {s.attention.length > 0 && <Badge variant="secondary">{s.attention.length}</Badge>}
                </span>
              }
            >
              {s.attention.length === 0 ? (
                <p className="text-muted-foreground text-sm">Everything looks good.</p>
              ) : (
                <ul className="divide-y">
                  {s.attention.slice(0, 10).map((a) => (
                    <li key={`${a.kind}/${a.namespace}/${a.name}/${a.reason}`} className="flex items-start gap-3 py-2.5">
                      <AlertTriangle
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          a.reason === "Drifted" || a.reason === "PowerOffRequired" ? "text-warning" : "text-destructive",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={a.kind === "VirtualMachine" ? "/vms/$ns/$name" : "/contexts/$ns/$name"}
                          params={{ ns: a.namespace, name: a.name }}
                          className="text-sm font-medium hover:underline"
                        >
                          {a.name}
                        </Link>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {a.kind === "VirtualMachine" ? "VM" : "Prism Central"} · {a.namespace}
                        </span>
                        <div className="text-muted-foreground text-xs">
                          {a.reason}
                          {a.message ? `: ${a.message}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section
              title="Recent activity"
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/events">
                    All events <ArrowRight />
                  </Link>
                </Button>
              }
            >
              {events.isLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" /> Loading…
                </div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <EventList events={(events.data ?? []).slice(0, 200)} showObject />
                </div>
              )}
            </Section>
          </div>
        </>
      ) : null}
    </Page>
  );
}
