import { formatBytes, type VirtualMachine, type VMSummary } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cpu, HardDrive, MemoryStick, Network, ServerCog } from "lucide-react";
import { Sparkline, usageTone } from "@/components/charts";
import { PhaseBadge, PowerIcon } from "@/components/status";
import { Checkbox } from "@/components/ui/checkbox";
import { vmMetricsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { VMActions } from "./actions";

export type VMRow = VMSummary & { vm: VirtualMachine };

export function VMCard({ r, selected, onToggle }: { r: VMRow; selected?: boolean; onToggle?: () => void }) {
  const live = r.powerState === "On" && !!r.externalID;
  const m = useQuery({ ...vmMetricsQuery(r.namespace, r.name, "1h", live), refetchInterval: 60_000 });
  const cpu = m.data?.current.cpu;
  return (
    <div className={cn("surface surface-hover group relative flex flex-col", selected && "border-primary/50 ring-primary/20 ring-2")}>
      <div className="flex items-start gap-3 p-4 pb-3">
        {onToggle && <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" aria-label={`Select ${r.displayName}`} />}
        <Link to="/vms/$ns/$name" params={{ ns: r.namespace, name: r.name }} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PowerIcon observed={r.powerState} desired={r.desiredPowerState} />
            <span className="truncate font-semibold">{r.displayName}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 truncate font-mono text-[11.5px]">
            {r.namespace}/{r.name}
          </div>
        </Link>
        <VMActions vm={r.vm} />
      </div>
      <div className="flex items-center justify-between gap-2 px-4">
        <PhaseBadge phase={r.phase} />
        {r.primaryIP && <span className="text-muted-foreground font-mono text-xs">{r.primaryIP}</span>}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 px-4">
        <div>
          <div className="text-muted-foreground flex items-center gap-1 text-[11px]">
            <Cpu className="size-3" /> CPU now
          </div>
          <div className="tabular text-lg font-semibold" style={{ color: cpu !== undefined ? usageTone(cpu) : undefined }}>
            {live ? (cpu !== undefined ? `${cpu.toFixed(1)}%` : "…") : "—"}
          </div>
        </div>
        <Sparkline values={(m.data?.points ?? []).map((p) => p.cpu ?? 0)} max={100} color={usageTone(cpu)} width={120} height={32} />
      </div>
      <div className="text-muted-foreground mt-4 grid grid-cols-4 gap-2 border-t px-4 py-2.5 text-[11px]">
        <span className="flex items-center gap-1" title="vCPU">
          <Cpu className="size-3" /> {r.vcpus}
        </span>
        <span className="flex items-center gap-1" title="Memory">
          <MemoryStick className="size-3" /> {formatBytes(r.memoryBytes, 0)}
        </span>
        <span className="flex items-center gap-1" title="Storage">
          <HardDrive className="size-3" /> {r.diskBytes ? formatBytes(r.diskBytes, 0) : "—"}
        </span>
        <span className="flex items-center gap-1 truncate" title={`Cluster ${r.cluster}`}>
          <ServerCog className="size-3 shrink-0" /> <span className="truncate">{r.cluster}</span>
        </span>
      </div>
      {r.nicCount === 0 && (
        <span className="text-muted-foreground absolute top-3 right-12 text-[10px]">
          <Network className="size-3" />
        </span>
      )}
    </div>
  );
}
