import type { Condition, VMPhase } from "@console/shared";
import { CheckCircle2, CircleDashed, CircleHelp, Loader2, PauseCircle, Power, PowerOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const PHASE_STYLE: Record<VMPhase, { cls: string; spin?: boolean }> = {
  Running: { cls: "bg-success/12 text-success border-success/25" },
  Stopped: { cls: "bg-muted text-muted-foreground border-border" },
  Pending: { cls: "bg-muted text-muted-foreground border-border", spin: true },
  Provisioning: { cls: "bg-info/12 text-info border-info/25", spin: true },
  Starting: { cls: "bg-info/12 text-info border-info/25", spin: true },
  Stopping: { cls: "bg-warning/15 text-warning border-warning/30", spin: true },
  Restarting: { cls: "bg-info/12 text-info border-info/25", spin: true },
  Updating: { cls: "bg-info/12 text-info border-info/25", spin: true },
  Deleting: { cls: "bg-destructive/10 text-destructive border-destructive/25", spin: true },
  Degraded: { cls: "bg-warning/15 text-warning border-warning/30" },
  Error: { cls: "bg-destructive/10 text-destructive border-destructive/25" },
  Unknown: { cls: "bg-muted text-muted-foreground border-border" },
};

export function PhaseBadge({ phase, className, title }: { phase: VMPhase; className?: string; title?: string }) {
  const s = PHASE_STYLE[phase] ?? PHASE_STYLE.Unknown;
  const badge = (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", s.cls, className)}>
      {s.spin ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      {phase}
    </Badge>
  );
  if (!title) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-sm">{title}</TooltipContent>
    </Tooltip>
  );
}

export function PowerIcon({ observed, desired, className }: { observed?: string; desired?: string; className?: string }) {
  const transitioning = observed && desired && observed !== desired;
  const label = transitioning
    ? `Powering ${desired?.toLowerCase()} (currently ${observed})`
    : observed
      ? `Powered ${observed.toLowerCase()}`
      : "Unknown power state";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center", className)}>
          {transitioning ? (
            <Loader2 className="text-info size-4 animate-spin" />
          ) : observed === "On" ? (
            <Power className="text-success size-4" />
          ) : observed === "Off" ? (
            <PowerOff className="text-muted-foreground size-4" />
          ) : (
            <CircleHelp className="text-muted-foreground size-4" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ConditionIcon({ status, className }: { status?: string; className?: string }) {
  if (status === "True") return <CheckCircle2 className={cn("text-success size-4", className)} />;
  if (status === "False") return <XCircle className={cn("text-destructive size-4", className)} />;
  return <CircleDashed className={cn("text-muted-foreground size-4", className)} />;
}

/** Conditions whose "True" status is undesirable. */
const NEGATIVE = new Set(["Drifted", "Deleting", "ProbesDegraded", "PowerOffRequired"]);

export function ConditionList({ conditions, order }: { conditions?: Condition[]; order?: string[] }) {
  if (!conditions?.length) return <p className="text-muted-foreground text-sm">No conditions reported yet.</p>;
  const sorted = [...conditions].sort((a, b) => {
    const ia = order?.indexOf(a.type) ?? -1;
    const ib = order?.indexOf(b.type) ?? -1;
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <ul className="divide-y">
      {sorted.map((c) => {
        const negative = NEGATIVE.has(c.type);
        const status = negative ? (c.status === "True" ? "False" : c.status === "False" ? "True" : c.status) : c.status;
        return (
          <li key={c.type} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <ConditionIcon status={status} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium">{c.type}</span>
                <span className="text-muted-foreground text-xs">{relativeTime(c.lastTransitionTime)}</span>
              </div>
              {c.reason && <div className="text-muted-foreground text-xs">{c.reason}</div>}
              {c.message && <div className="mt-0.5 text-sm break-words">{c.message}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ReadyBadge({ status, reason }: { status?: string; reason?: string }) {
  const ok = status === "True";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5",
        ok ? "bg-success/12 text-success border-success/25" : status === "False" ? "bg-destructive/10 text-destructive border-destructive/25" : "",
      )}
    >
      <ConditionIcon status={status} className="size-3" />
      {ok ? "Ready" : (reason ?? (status === "False" ? "Not ready" : "Unknown"))}
    </Badge>
  );
}

export function PausedBadge() {
  return (
    <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 gap-1">
      <PauseCircle className="size-3" /> Paused
    </Badge>
  );
}
