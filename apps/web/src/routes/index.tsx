import { formatBytes, getCondition, summarizeVM } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  HardDrive,
  Info,
  LayoutTemplate,
  MemoryStick,
  Network,
  Plus,
  Server,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";
import { BrandMark } from "@/components/brand";
import { EmptyState, ErrorState, LoadingState, Page, Section, StatTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClusterCapacity, PhaseBreakdown, TopConsumers } from "@/features/dashboard/fleet-cards";
import { EventList } from "@/features/events/event-list";
import { useAlerts } from "@/lib/alerts";
import { useNamespace, useWorkspace } from "@/lib/namespace";
import { contextsQuery, eventsQuery, statsQuery, useMe, vmsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Dashboard });

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Hero({ user, workspace, healthy, total, issues }: { user?: string; workspace?: string; healthy: number; total: number; issues: number }) {
  const pct = total ? Math.round((healthy / total) * 100) : 100;
  return (
    <div className="surface bg-hero animate-fade-up relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <BrandMark className="size-12 shrink-0 shadow-lg" />
          <div className="min-w-0">
            <div className="text-muted-foreground text-[13px]">{greeting()},</div>
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">{user}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {workspace ? `Workspace ${workspace}` : "All workspaces you can access"} ·{" "}
              {issues ? (
                <span className="text-warning font-medium">
                  {issues} item{issues > 1 ? "s" : ""} need attention
                </span>
              ) : (
                <span className="text-success font-medium">all systems nominal</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="bg-card/70 flex items-center gap-3 rounded-xl border px-4 py-2.5 backdrop-blur">
            <div className="relative size-10">
              <svg viewBox="0 0 36 36" className="size-10 -rotate-90" aria-hidden="true">
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--muted)" strokeWidth="4" />
                <circle
                  cx="18"
                  cy="18"
                  r="15"
                  fill="none"
                  stroke={pct >= 90 ? "var(--success)" : pct >= 60 ? "var(--warning)" : "var(--destructive)"}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * 94.2} 94.2`}
                />
              </svg>
            </div>
            <div>
              <div className="tabular text-lg leading-none font-semibold">{pct}%</div>
              <div className="text-muted-foreground mt-0.5 text-xs">fleet healthy</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild className="bg-card/70 backdrop-blur">
              <Link to="/templates">
                <LayoutTemplate /> Deploy template
              </Link>
            </Button>
            <Button asChild className="shadow-md">
              <Link to="/vms/new">
                <Plus /> Create VM
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ICON = { critical: AlertTriangle, warning: AlertTriangle, info: Info } as const;
const TONE = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/12 text-info",
} as const;

function Attention() {
  const { alerts } = useAlerts();
  return (
    <Section
      title="Needs attention"
      icon={<AlertTriangle />}
      description={alerts.length ? `${alerts.length} open item(s)` : undefined}
      bodyClassName="p-0 sm:p-0"
    >
      {alerts.length === 0 ? (
        <div className="flex items-center gap-3 p-5">
          <span className="bg-success/12 text-success flex size-9 items-center justify-center rounded-lg">
            <CheckCircle2 className="size-5" />
          </span>
          <div>
            <div className="text-sm font-medium">Nothing to do</div>
            <div className="text-muted-foreground text-xs">No failure, drift or disconnected Prism Central.</div>
          </div>
        </div>
      ) : (
        <ul className="divide-y">
          {alerts.slice(0, 8).map((a) => {
            const Icon = ICON[a.severity];
            return (
              <li key={a.id}>
                <Link
                  to={a.kind === "vm" ? "/vms/$ns/$name" : "/contexts/$ns/$name"}
                  params={{ ns: a.namespace, name: a.name }}
                  className="hover:bg-accent/50 flex items-start gap-3 px-5 py-3 transition-colors"
                >
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", TONE[a.severity])}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.title}</span>
                    {a.detail && <span className="text-muted-foreground line-clamp-1 text-xs">{a.detail}</span>}
                  </span>
                  <ArrowRight className="text-muted-foreground mt-1 size-3.5 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Dashboard() {
  const ns = useNamespace();
  const workspace = useWorkspace();
  const me = useMe();
  const q = useQuery(statsQuery(ns));
  const vms = useQuery(vmsQuery(ns));
  const ctxs = useQuery(contextsQuery(ns));
  const events = useQuery(eventsQuery(ns));
  const { alerts } = useAlerts();
  const summaries = useMemo(() => (vms.data ?? []).map(summarizeVM), [vms.data]);
  const s = q.data;
  const connected = (ctxs.data ?? []).find((c) => getCondition(c.status?.conditions, "Connected")?.status === "True");
  const primaryContext = connected ? { namespace: connected.metadata.namespace as string, name: connected.metadata.name as string } : undefined;

  return (
    <Page>
      <Hero user={me.data?.user} workspace={workspace?.displayName} healthy={s?.vms.ready ?? 0} total={s?.vms.total ?? 0} issues={alerts.length} />
      {q.isLoading ? (
        <LoadingState rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Link to="/vms" className="surface-hover rounded-xl">
              <StatTile icon={<Server />} label="Virtual machines" value={s.vms.total} sub={`${s.vms.on} running · ${s.vms.off} stopped`} />
            </Link>
            <Link to="/vms" className="surface-hover rounded-xl">
              <StatTile
                icon={<Activity />}
                tone={s.vms.notReady ? "warning" : "success"}
                label="Ready"
                value={
                  <>
                    {s.vms.ready}
                    <span className="text-muted-foreground text-base font-normal">/{s.vms.total}</span>
                  </>
                }
                sub={s.vms.activeTasks ? `${s.vms.activeTasks} operation(s) in progress` : "No operation in progress"}
              />
            </Link>
            <Link to="/contexts" className="surface-hover rounded-xl">
              <StatTile
                icon={<ServerCog />}
                tone={s.contexts.disconnected ? "danger" : "violet"}
                label="Prism Central"
                value={
                  <>
                    {s.contexts.connected}
                    <span className="text-muted-foreground text-base font-normal">/{s.contexts.total}</span>
                  </>
                }
                sub={s.contexts.disconnected ? `${s.contexts.disconnected} disconnected` : "All contexts connected"}
              />
            </Link>
            <Link to="/services" className="surface-hover rounded-xl">
              <StatTile
                icon={<Network />}
                tone="info"
                label="VM services"
                value={s.services.total}
                sub={`${s.services.readyEndpoints}/${s.services.selectedVms} endpoints ready`}
              />
            </Link>
          </div>

          {s.vms.total === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-6" />}
              title="Your fleet is empty"
              description="Connect a Prism Central account, then create a VM or deploy one from a template in a few clicks."
              action={
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <Link to="/contexts/new">Add Prism Central</Link>
                  </Button>
                  <Button asChild>
                    <Link to="/vms/new">
                      <Plus /> Create VM
                    </Link>
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="grid content-start gap-5">
                <Section title="Fleet status" icon={<Server />} description={`${summaries.length} VMs`}>
                  <PhaseBreakdown summaries={summaries} />
                  <div className="mt-5 grid grid-cols-3 gap-3 border-t pt-4">
                    {[
                      { icon: <Cpu className="size-4" />, label: "vCPU", value: s.capacity.vcpus },
                      { icon: <MemoryStick className="size-4" />, label: "Memory", value: formatBytes(s.capacity.memoryBytes) },
                      { icon: <HardDrive className="size-4" />, label: "Storage", value: formatBytes(s.capacity.diskBytes) },
                    ].map((x) => (
                      <div key={x.label}>
                        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                          {x.icon} {x.label}
                        </div>
                        <div className="tabular mt-1 text-lg font-semibold">{x.value}</div>
                        <div className="text-muted-foreground text-[11px]">allocated</div>
                      </div>
                    ))}
                  </div>
                </Section>
                <Attention />
              </div>
              <div className="grid content-start gap-5">
                <ClusterCapacity context={primaryContext} />
                <TopConsumers scope={ns} />
              </div>
            </div>
          )}

          <Section
            title="Recent activity"
            icon={<Activity />}
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/events">
                  All activity <ArrowRight />
                </Link>
              </Button>
            }
          >
            {events.isLoading ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="max-h-[26rem] overflow-auto pr-1">
                <EventList events={(events.data ?? []).slice(0, 60)} showObject />
              </div>
            )}
          </Section>
        </>
      ) : null}
    </Page>
  );
}
