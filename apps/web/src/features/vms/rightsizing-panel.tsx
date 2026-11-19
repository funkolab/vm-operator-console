import type { RightsizingAdvice, VirtualMachine } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Hourglass, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import { UsageBar } from "@/components/charts";
import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, unwrap } from "@/lib/api";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const rightsizingQuery = (ns: string, name: string, enabled = true) => ({
  queryKey: ["vm-rightsizing", ns, name],
  queryFn: () => unwrap(api.namespaces[":ns"].vms[":name"].rightsizing.$get({ param: { ns, name } })),
  staleTime: 10 * 60_000,
  enabled,
  retry: false,
});

const VERDICT = {
  oversized: { icon: TrendingDown, title: "Oversized", cls: "bg-info/10 text-info ring-info/25" },
  undersized: { icon: TrendingUp, title: "Undersized", cls: "bg-warning/12 text-warning ring-warning/30" },
  balanced: { icon: CheckCircle2, title: "Right-sized", cls: "bg-success/10 text-success ring-success/25" },
  "insufficient-data": { icon: Hourglass, title: "Collecting data", cls: "bg-muted text-muted-foreground ring-border" },
} as const;

export function VerdictBadge({ verdict }: { verdict: RightsizingAdvice["verdict"] }) {
  const v = VERDICT[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", v.cls)}>
      <v.icon className="size-3.5" /> {v.title}
    </span>
  );
}

function Row({ label, p95, avg, current, suggested, unit }: { label: string; p95?: number; avg?: number; current: number; suggested: number; unit: string }) {
  const changed = suggested !== current;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular flex items-center gap-1.5">
          <span className={cn(changed && "text-muted-foreground line-through decoration-1")}>
            {current} {unit}
          </span>
          {changed && (
            <>
              <ArrowRight className="text-muted-foreground size-3.5" />
              <span className="font-semibold">
                {suggested} {unit}
              </span>
            </>
          )}
        </span>
      </div>
      <UsageBar value={p95} />
      <div className="text-muted-foreground flex justify-between text-[11px]">
        <span>p95 {p95 !== undefined ? `${p95}%` : "—"}</span>
        <span>avg {avg !== undefined ? `${avg}%` : "—"}</span>
      </div>
    </div>
  );
}

/** Rightsizing advice for a VM based on 7 days of Prism Central metrics. */
export function RightsizingPanel({ vm }: { vm: VirtualMachine }) {
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const can = useCan();
  const navigate = useNavigate();
  const q = useQuery(rightsizingQuery(ns, name, !!vm.status?.externalID));
  const a = q.data;
  const actionable = a && (a.verdict === "oversized" || a.verdict === "undersized");
  return (
    <Section
      title="Rightsizing"
      icon={<Lightbulb />}
      description="7-day p95 utilization from Prism Central"
      actions={a ? <VerdictBadge verdict={a.verdict} /> : undefined}
    >
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : !a?.available ? (
        <p className="text-muted-foreground text-sm">{a?.message ?? "Metrics unavailable."}</p>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Row label="vCPU" p95={a.cpu.p95} avg={a.cpu.avg} current={a.cpu.current} suggested={a.cpu.suggested} unit="vCPU" />
            <Row label="Memory" p95={a.memory.p95} avg={a.memory.avg} current={a.memory.currentGiB} suggested={a.memory.suggestedGiB} unit="GiB" />
          </div>
          <ul className="text-muted-foreground grid gap-1 text-sm">
            {a.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-foreground/40">•</span> {r}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <span className="text-muted-foreground text-xs">{a.samples} hourly samples analyzed</span>
            {actionable && (
              <Button
                size="sm"
                disabled={!can(ns, "virtualmachines", "update")}
                onClick={() =>
                  navigate({
                    to: "/vms/$ns/$name/edit",
                    params: { ns, name },
                    search: { cpu: a.cpu.suggested, memGiB: a.memory.suggestedGiB },
                  })
                }
              >
                Review the change <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
