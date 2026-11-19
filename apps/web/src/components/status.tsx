import type { Condition, VMPhase } from "@console/shared";
import { CheckCircle2, CircleDashed, CircleHelp, Loader2, PauseCircle, Power, PowerOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const PHASE_STYLE: Record<VMPhase, { cls: string; dot: string; spin?: boolean; pulse?: boolean }> = {
  Running: { cls: "bg-success/10 text-success ring-success/25", dot: "bg-success", pulse: true },
  Stopped: { cls: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  Pending: { cls: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground", spin: true },
  Provisioning: { cls: "bg-info/10 text-info ring-info/25", dot: "bg-info", spin: true },
  Starting: { cls: "bg-info/10 text-info ring-info/25", dot: "bg-info", spin: true },
  Stopping: { cls: "bg-warning/12 text-warning ring-warning/30", dot: "bg-warning", spin: true },
  Restarting: { cls: "bg-info/10 text-info ring-info/25", dot: "bg-info", spin: true },
  Updating: { cls: "bg-violet/10 text-violet ring-violet/25", dot: "bg-violet", spin: true },
  Deleting: { cls: "bg-destructive/10 text-destructive ring-destructive/25", dot: "bg-destructive", spin: true },
  Degraded: { cls: "bg-warning/12 text-warning ring-warning/30", dot: "bg-warning" },
  Error: { cls: "bg-destructive/10 text-destructive ring-destructive/25", dot: "bg-destructive" },
  Unknown: { cls: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
};

export function PhaseBadge({ phase, className, title }: { phase: VMPhase; className?: string; title?: string }) {
  const s = PHASE_STYLE[phase] ?? PHASE_STYLE.Unknown;
  const badge = (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", s.cls, className)}>
      {s.spin ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <span className={cn("size-1.5 rounded-full", s.dot, s.pulse && "animate-pulse-ring text-success")} />
      )}
      {phase}
    </span>
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
        const expected = !negative && c.status === "False" && EXPECTED_NOT_READY.has(c.reason ?? "");
        const status = expected ? "Unknown" : negative ? (c.status === "True" ? "False" : c.status === "False" ? "True" : c.status) : c.status;
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

/** Reasons for a Ready=False condition that reflect a deliberate state, not a failure. */
const EXPECTED_NOT_READY = new Set(["PoweredOff", "Paused", "Deleting"]);

export function ReadyBadge({ status, reason }: { status?: string; reason?: string }) {
  const ok = status === "True";
  const neutral = status === "False" && EXPECTED_NOT_READY.has(reason ?? "");
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset",
        ok
          ? "bg-success/10 text-success ring-success/25"
          : neutral
            ? "bg-muted text-muted-foreground ring-border"
            : status === "False"
              ? "bg-destructive/10 text-destructive ring-destructive/25"
              : "bg-muted text-muted-foreground ring-border",
      )}
    >
      {neutral ? <CircleDashed className="size-3" /> : <ConditionIcon status={status} className="size-3" />}
      {ok ? "Ready" : (reason ?? (status === "False" ? "Not ready" : "Unknown"))}
    </span>
  );
}

export function PausedBadge() {
  return (
    <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 gap-1">
      <PauseCircle className="size-3" /> Paused
    </Badge>
  );
}
