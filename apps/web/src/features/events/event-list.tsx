import { eventTimestamp, type KubeEvent } from "@console/shared";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Cpu,
  Network,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ServerCog,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { EmptyState } from "@/components/page";
import { formatDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "success" | "muted" | "primary" | "violet" | "warning";

/** Visual category of an event, inferred from its reason. */
function categorize(e: KubeEvent): { icon: ComponentType<{ className?: string }>; tone: Tone } {
  const r = e.reason ?? "";
  if (e.type === "Warning") return { icon: AlertTriangle, tone: "warning" };
  if (r.startsWith("Scheduled")) return { icon: CalendarClock, tone: "violet" };
  if (/^PoweredOn|PowerOn/.test(r)) return { icon: r.endsWith("Submitted") ? Play : Power, tone: "success" };
  if (/^PoweredOff|PowerOff|Shutdown/.test(r)) return { icon: PowerOff, tone: "muted" };
  if (/Restart|Reboot|Reset/.test(r)) return { icon: RefreshCw, tone: "primary" };
  if (/Creat|Provision/.test(r)) return { icon: Plus, tone: "primary" };
  if (/Delet/.test(r)) return { icon: Trash2, tone: "muted" };
  if (/Updat|Resiz|Reconfigur|Drift/.test(r)) return { icon: Pencil, tone: "primary" };
  if (/Ready|Connected|Established|Synced/.test(r)) return { icon: CheckCircle2, tone: "success" };
  if (e.involvedObject.kind === "VirtualMachineService") return { icon: Network, tone: "primary" };
  if (e.involvedObject.kind === "NutanixPrismContext") return { icon: ServerCog, tone: "primary" };
  if (/CPU|Memory|Compute/.test(r)) return { icon: Cpu, tone: "primary" };
  return { icon: CircleDot, tone: "primary" };
}

const TONE: Record<Tone, string> = {
  success: "bg-success/12 text-success ring-success/25",
  muted: "bg-muted text-muted-foreground ring-border",
  primary: "bg-primary/10 text-primary ring-primary/20",
  violet: "bg-violet/12 text-violet ring-violet/25",
  warning: "bg-warning/15 text-warning ring-warning/30",
};

function ObjectLink({ e }: { e: KubeEvent }) {
  const { kind, namespace: ns, name } = e.involvedObject;
  if (!name || !ns) return null;
  const cls = "text-foreground/80 hover:text-foreground font-mono text-xs hover:underline";
  if (kind === "VirtualMachine")
    return (
      <Link to="/vms/$ns/$name" params={{ ns, name }} className={cls}>
        {ns}/{name}
      </Link>
    );
  if (kind === "VirtualMachineService")
    return (
      <Link to="/services/$ns/$name" params={{ ns, name }} className={cls}>
        {ns}/{name}
      </Link>
    );
  if (kind === "NutanixPrismContext")
    return (
      <Link to="/contexts/$ns/$name" params={{ ns, name }} className={cls}>
        {ns}/{name}
      </Link>
    );
  return (
    <span className="text-muted-foreground font-mono text-xs">
      {kind} {ns}/{name}
    </span>
  );
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
function dayLabel(iso?: string): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return dayFmt.format(d);
}

export function EventList({ events, showObject }: { events: KubeEvent[]; showObject?: boolean }) {
  const sorted = [...events].sort((a, b) => (eventTimestamp(b) ?? "").localeCompare(eventTimestamp(a) ?? ""));
  if (!sorted.length) return <EmptyState title="No events" description="Kubernetes keeps events for about one hour." className="py-8" />;
  const groups: { label: string; items: KubeEvent[] }[] = [];
  for (const e of sorted) {
    const label = dayLabel(eventTimestamp(e));
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }
  return (
    <div className="grid gap-4">
      {groups.map((g) => (
        <div key={g.label}>
          {groups.length > 1 || g.label !== "Today" ? (
            <div className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase">{g.label}</div>
          ) : null}
          <ol className="relative">
            {g.items.map((e, i) => {
              const { icon: Icon, tone } = categorize(e);
              const count = e.count ?? e.series?.count ?? 1;
              return (
                <li key={e.metadata.uid ?? `${e.metadata.name}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < g.items.length - 1 && <span aria-hidden className="bg-border absolute top-8 bottom-0 left-[13px] w-px" />}
                  <span className={cn("relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", TONE[tone])}>
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={cn("text-sm font-medium", e.type === "Warning" && "text-warning")}>{e.reason}</span>
                      {showObject && <ObjectLink e={e} />}
                      {count > 1 && <span className="bg-muted text-muted-foreground rounded px-1.5 text-[11px] font-medium">×{count}</span>}
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums" title={formatDate(eventTimestamp(e))}>
                        {relativeTime(eventTimestamp(e))}
                      </span>
                    </div>
                    {e.message && <p className="text-muted-foreground mt-0.5 text-sm break-words">{e.message}</p>}
                    {e.source?.component === "vm-operator-console" && <p className="text-violet mt-0.5 text-xs">by the console scheduler</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
