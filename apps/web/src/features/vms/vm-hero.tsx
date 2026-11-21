import { Annotations, formatBytes, refLabel, summarizeVM, type VirtualMachine } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  HardDrive,
  Info,
  LayoutTemplate,
  Loader2,
  MemoryStick,
  Network,
  PauseCircle,
  ServerCog,
  XCircle,
} from "lucide-react";
import { Sparkline, usageTone } from "@/components/charts";
import { Copyable } from "@/components/copy-button";
import { PhaseBadge, PowerIcon } from "@/components/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspaceTag } from "@/components/workspace-select";
import { relativeTime } from "@/lib/format";
import { vmMetricsQuery, vmPlacementQuery, vmTaskQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

function Chip({ icon, children, title }: { icon: React.ReactNode; children: React.ReactNode; title?: string }) {
  const el = (
    <span className="bg-background/70 text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs backdrop-blur [&_svg]:size-3.5 [&_svg]:shrink-0">
      {icon}
      <span className="text-foreground truncate">{children}</span>
    </span>
  );
  if (!title) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

const TASK_LABEL: Record<string, string> = {
  Create: "Creating VM",
  CreateFromTemplate: "Deploying from template",
  PowerOn: "Powering on",
  PowerOff: "Powering off",
  UpdateVM: "Updating configuration",
  AddDisk: "Adding disk",
  GrowDisk: "Growing disk",
  DeleteDisk: "Removing disk",
  AddCDRom: "Adding CD-ROM",
  DeleteCDRom: "Removing CD-ROM",
  AddNic: "Adding NIC",
  DeleteNic: "Removing NIC",
  Delete: "Deleting VM",
  AddCustomAttributes: "Tagging VM",
  RemoveCustomAttributes: "Untagging VM",
};

/** Live Prism Central task progress for the VM's in-flight operation. */
export function TaskProgressBanner({ vm }: { vm: VirtualMachine }) {
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const task = vm.status?.activeTask;
  const restart = vm.metadata.annotations?.[Annotations.restartPending];
  const s = summarizeVM(vm);
  const q = useQuery(vmTaskQuery(ns, name, !!task && !!vm.status?.externalID));
  if (!task && !restart && !s.converging && !s.paused) return null;
  if (s.paused && !task)
    return (
      <div className="border-warning/30 bg-warning/8 flex items-start gap-3 rounded-xl border px-4 py-3">
        <PauseCircle className="text-warning mt-0.5 size-5 shrink-0" />
        <div>
          <div className="text-sm font-medium">Reconciliation paused</div>
          <div className="text-muted-foreground text-xs">vm-operator ignores changes to this VM until reconciliation is resumed.</div>
        </div>
      </div>
    );
  const t = q.data?.available ? q.data : undefined;
  const pct = t?.progress ?? (task ? undefined : restart ? 50 : undefined);
  const failed = t?.status === "FAILED";
  const label = task ? (TASK_LABEL[task.kind] ?? task.kind) : restart ? "Restarting" : "Applying changes";
  return (
    <div className={cn("surface overflow-hidden", failed ? "border-destructive/40" : "border-info/30")}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className={cn("flex size-8 items-center justify-center rounded-lg", failed ? "bg-destructive/10 text-destructive" : "bg-info/12 text-info")}>
          {failed ? (
            <XCircle className="size-4" />
          ) : t?.status === "SUCCEEDED" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {label}
            {t?.status && <span className="text-muted-foreground text-xs font-normal">· {t.status.toLowerCase()}</span>}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {task
              ? `${t?.description ?? "Prism Central task"}${task.targetName ? ` · ${task.targetName}` : ""}${t?.startedTime ? ` · started ${relativeTime(t.startedTime)}` : ""}`
              : restart
                ? "Waiting for the VM to power off before powering it back on"
                : `Converging generation ${vm.metadata.generation} (applied ${vm.status?.appliedGeneration ?? 0})`}
          </div>
          {failed && t?.errorMessages?.length ? <div className="text-destructive mt-1 text-xs">{t.errorMessages.join(" · ")}</div> : null}
        </div>
        {pct !== undefined && <span className="tabular text-sm font-semibold">{pct}%</span>}
      </div>
      <div className="bg-muted h-1">
        {pct !== undefined ? (
          <div className={cn("h-full transition-[width] duration-500", failed ? "bg-destructive" : "bg-info")} style={{ width: `${pct}%` }} />
        ) : (
          <div
            className="bg-info/60 h-full w-1/3 animate-[shimmer_1.6s_linear_infinite] rounded-full"
            style={{
              backgroundImage: "linear-gradient(90deg,transparent,var(--info),transparent)",
              width: "100%",
              backgroundSize: "40% 100%",
              backgroundRepeat: "no-repeat",
            }}
          />
        )}
      </div>
    </div>
  );
}

/** VM header: identity, power, live usage sparkline and where it runs. */
export function VMHero({ vm, actions }: { vm: VirtualMachine; actions: React.ReactNode }) {
  const s = summarizeVM(vm);
  const ns = s.namespace;
  const provisioned = !!vm.status?.externalID;
  const placement = useQuery(vmPlacementQuery(ns, s.name, provisioned));
  const metrics = useQuery(vmMetricsQuery(ns, s.name, "1h", provisioned && vm.status?.powerState === "On"));
  const p = placement.data?.available ? placement.data : undefined;
  const cur = metrics.data?.current;
  return (
    <div className="surface bg-hero animate-fade-up relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black,transparent_60%)]" />
      <div className="relative flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="bg-card ring-border relative flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-md ring-1">
              <Boxes className="text-primary size-6" />
              <span className="bg-card absolute -right-1 -bottom-1 rounded-full p-0.5 shadow">
                <PowerIcon observed={s.powerState} desired={s.desiredPowerState} />
              </span>
            </div>
            <div className="min-w-0">
              <div className="text-muted-foreground mb-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase">Virtual machine</div>
              <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.6rem] leading-tight font-semibold tracking-[-0.02em]">
                <span className="truncate">{s.displayName}</span>
                <PhaseBadge phase={s.phase} title={s.ready !== "True" ? [s.readyReason, s.readyMessage].filter(Boolean).join(": ") : undefined} />
              </h1>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <WorkspaceTag namespace={ns} />
                <span className="font-mono text-[12.5px]">{s.name}</span>
                {s.primaryIP && <Copyable value={s.primaryIP} />}
                {vm.spec.description && <span className="truncate">{vm.spec.description}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip icon={<Cpu />}>
            {s.vcpus} vCPU · {formatBytes(s.memoryBytes)}
          </Chip>
          <Chip icon={<HardDrive />}>
            {s.diskBytes ? formatBytes(s.diskBytes) : "—"} · {s.diskCount} disk{s.diskCount > 1 ? "s" : ""}
          </Chip>
          <Chip icon={<Network />}>
            {s.nicCount} NIC{s.nicCount > 1 ? "s" : ""}
            {vm.spec.network?.nics?.[0] ? ` · ${refLabel(vm.spec.network.nics[0].networkInfo?.subnet)}` : ""}
          </Chip>
          <Chip icon={<ServerCog />} title={p?.host?.cpuModel}>
            {p?.cluster?.name ?? s.cluster}
            {p?.host?.name ? ` › ${p.host.name}` : ""}
          </Chip>
          {s.template && (
            <Link to="/templates/$ns/$name" params={{ ns, name: s.template }}>
              <Chip icon={<LayoutTemplate />}>{s.template}</Chip>
            </Link>
          )}
          <Chip icon={<Clock />}>created {relativeTime(s.createdAt)}</Chip>
          {p?.prismUrl && (
            <a
              href={p.prismUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 px-1 text-xs font-medium hover:underline"
            >
              Open in Prism Central <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        {provisioned && vm.status?.powerState === "On" && metrics.data?.available && (
          <div className="grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4">
            {[
              { label: "CPU", icon: <Cpu className="size-3.5" />, v: cur?.cpu, key: "cpu" as const },
              { label: "Memory", icon: <MemoryStick className="size-3.5" />, v: cur?.mem, key: "mem" as const },
            ].map((m) => (
              <div key={m.label} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-muted-foreground flex items-center gap-1 text-xs">
                    {m.icon} {m.label}
                  </div>
                  <div className="tabular text-lg font-semibold">{m.v !== undefined ? `${m.v.toFixed(1)}%` : "—"}</div>
                </div>
                <Sparkline values={(metrics.data?.points ?? []).map((pt) => pt[m.key] ?? 0)} max={100} color={usageTone(m.v)} width={88} height={30} />
              </div>
            ))}
            <div>
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <HardDrive className="size-3.5" /> IOPS
              </div>
              <div className="tabular text-lg font-semibold">{cur?.iops?.toLocaleString() ?? "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <Info className="size-3.5" /> Live migrate
              </div>
              <div className="text-lg font-semibold">{p?.isLiveMigrateCapable === undefined ? "—" : p.isLiveMigrateCapable ? "Capable" : "No"}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
