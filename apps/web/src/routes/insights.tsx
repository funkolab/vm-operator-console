import { getCondition, summarizeVM, type VMSummary } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Cpu, GitCompareArrows, Lightbulb, MemoryStick, PauseCircle, PowerOff, Sparkles, Unplug } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, Page, PageHeader, Section, StatTile } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { TopConsumers } from "@/features/dashboard/fleet-cards";
import { VerdictBadge } from "@/features/vms/rightsizing-panel";
import { api, unwrap } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ALL, useNamespace } from "@/lib/namespace";
import { vmsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/insights")({ component: InsightsPage });

const DAY = 86_400_000;

interface HygieneItem {
  key: string;
  s: VMSummary;
  detail: string;
}

function HygieneList({ title, icon, items, empty, tone }: { title: string; icon: React.ReactNode; items: HygieneItem[]; empty: string; tone: string }) {
  return (
    <Section title={title} icon={icon} description={items.length ? `${items.length} VM(s)` : undefined} bodyClassName="p-0 sm:p-0">
      {items.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 p-5 text-sm">
          <CheckCircle2 className="text-success size-4" /> {empty}
        </div>
      ) : (
        <ul className="divide-y">
          {items.slice(0, 8).map((i) => (
            <li key={i.key}>
              <Link
                to="/vms/$ns/$name"
                params={{ ns: i.s.namespace, name: i.s.name }}
                className="hover:bg-accent/50 flex items-center gap-3 px-5 py-2.5 transition-colors"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", tone)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.s.displayName}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {i.s.namespace} · {i.detail}
                  </span>
                </span>
                <ArrowRight className="text-muted-foreground size-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function InsightsPage() {
  const ns = useNamespace();
  const vms = useQuery(vmsQuery(ns));
  const rec = useQuery({
    queryKey: ["recommendations", ns],
    queryFn: () => unwrap(api.insights.recommendations.$get({ query: ns === ALL ? {} : { namespace: ns } })),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const sums = useMemo(() => (vms.data ?? []).map(summarizeVM), [vms.data]);
  const hygiene = useMemo(() => {
    const now = Date.now();
    const drift: HygieneItem[] = [];
    const longOff: HygieneItem[] = [];
    const noNet: HygieneItem[] = [];
    const paused: HygieneItem[] = [];
    for (const vm of vms.data ?? []) {
      const s = summarizeVM(vm);
      if (s.driftCount) drift.push({ key: s.key, s, detail: `${s.driftCount} field(s) changed outside Kubernetes` });
      if (s.powerState === "Off") {
        const since = getCondition(vm.status?.conditions, "PowerStateReconciled")?.lastTransitionTime;
        if (since && now - Date.parse(since) > 7 * DAY)
          longOff.push({ key: s.key, s, detail: `powered off ${relativeTime(since)} — still holding ${s.diskBytes ? "storage" : "resources"}` });
      }
      if (s.nicCount === 0) noNet.push({ key: s.key, s, detail: "no network interface" });
      if (s.paused) paused.push({ key: s.key, s, detail: "reconciliation paused — changes are not applied" });
    }
    return { drift, longOff, noNet, paused };
  }, [vms.data]);
  const r = rec.data;

  return (
    <Page>
      <PageHeader
        icon={<Sparkles className="size-5" />}
        eyebrow="Fleet intelligence"
        title="Insights"
        description="Rightsizing from 7 days of Prism Central metrics, configuration hygiene and the busiest VMs."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          icon={<Lightbulb />}
          tone="violet"
          label="Recommendations"
          value={rec.isLoading ? "…" : (r?.items.length ?? 0)}
          sub={r ? `${r.analyzed} running VM(s) analyzed` : "Analyzing…"}
        />
        <StatTile icon={<Cpu />} tone="info" label="Reclaimable vCPU" value={rec.isLoading ? "…" : (r?.reclaimable.vcpus ?? 0)} sub="from oversized VMs" />
        <StatTile
          icon={<MemoryStick />}
          tone="info"
          label="Reclaimable memory"
          value={rec.isLoading ? "…" : `${r?.reclaimable.memoryGiB ?? 0} GiB`}
          sub="from oversized VMs"
        />
        <StatTile
          icon={<GitCompareArrows />}
          tone={hygiene.drift.length ? "warning" : "success"}
          label="Hygiene findings"
          value={hygiene.drift.length + hygiene.longOff.length + hygiene.noNet.length + hygiene.paused.length}
          sub={`${sums.length} VM(s) checked`}
        />
      </div>

      <Section
        title="Rightsizing recommendations"
        icon={<Lightbulb />}
        description="Based on 7-day p95 CPU and active memory; shrink at most by half per step, grow before saturation"
        bodyClassName="p-0 sm:p-0"
      >
        {rec.isLoading ? (
          <div className="grid gap-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : !r?.items.length ? (
          <EmptyState
            className="m-5"
            icon={<CheckCircle2 className="size-6" />}
            title={r?.message ?? "Every analyzed VM is right-sized"}
            description="VMs need at least 24 hourly samples (about a day of activity) before a recommendation is made."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
                <tr>
                  <th className="px-5 py-2.5 text-left font-semibold">VM</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Verdict</th>
                  <th className="px-3 py-2.5 text-right font-semibold">CPU p95</th>
                  <th className="px-3 py-2.5 text-right font-semibold">vCPU</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mem p95</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Memory</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.items.map((i) => (
                  <tr key={`${i.namespace}/${i.name}`} className="hover:bg-accent/40">
                    <td className="px-5 py-3">
                      <div className="font-medium">{i.displayName}</div>
                      <div className="text-muted-foreground text-xs">{i.advice.reasons[0]}</div>
                    </td>
                    <td className="px-3 py-3">
                      <VerdictBadge verdict={i.advice.verdict} />
                    </td>
                    <td className="tabular px-3 py-3 text-right">{i.advice.cpu.p95 ?? "—"}%</td>
                    <td className="tabular px-3 py-3 text-right">
                      {i.advice.cpu.current} → <span className="font-semibold">{i.advice.cpu.suggested}</span>
                    </td>
                    <td className="tabular px-3 py-3 text-right">{i.advice.memory.p95 ?? "—"}%</td>
                    <td className="tabular px-3 py-3 text-right">
                      {i.advice.memory.currentGiB} → <span className="font-semibold">{i.advice.memory.suggestedGiB} GiB</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to="/vms/$ns/$name/edit"
                        params={{ ns: i.namespace, name: i.name }}
                        search={{ cpu: i.advice.cpu.suggested, memGiB: i.advice.memory.suggestedGiB }}
                        className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        Apply <ArrowRight className="size-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <HygieneList
          title="Configuration drift"
          icon={<GitCompareArrows />}
          items={hygiene.drift}
          empty="No VM drifted from its declared spec."
          tone="bg-warning"
        />
        <HygieneList
          title="Powered off for over a week"
          icon={<PowerOff />}
          items={hygiene.longOff}
          empty="No long-idle powered-off VM."
          tone="bg-muted-foreground"
        />
        <HygieneList title="Reconciliation paused" icon={<PauseCircle />} items={hygiene.paused} empty="No paused VM." tone="bg-warning" />
        <HygieneList title="Without network" icon={<Unplug />} items={hygiene.noNet} empty="Every VM has at least one NIC." tone="bg-info" />
      </div>
      <TopConsumers scope={ns} />
    </Page>
  );
}
