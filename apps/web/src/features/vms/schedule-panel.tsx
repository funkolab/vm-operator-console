import {
  describeRule,
  nextRuns,
  type PowerRule,
  type PowerSchedule,
  parseSchedule,
  SCHEDULE_ANNOTATION,
  SCHEDULE_PRESETS,
  type VirtualMachine,
  WEEKDAYS,
} from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Section, Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ZONES = [
  "UTC",
  "Europe/Paris",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const whenFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function RuleEditor({ rule, onChange, onRemove }: { rule: PowerRule; onChange: (r: PowerRule) => void; onRemove: () => void }) {
  return (
    <div className="bg-muted/30 grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={rule.action} onValueChange={(v) => onChange({ ...rule, action: v as PowerRule["action"] })}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="start">Power on</SelectItem>
            <SelectItem value="stop">Power off</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm">at</span>
        <Input type="time" value={rule.at} onChange={(e) => onChange({ ...rule, at: e.target.value })} className="w-28" aria-label="Time" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive ml-auto size-8"
          onClick={onRemove}
          aria-label="Remove rule"
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const on = rule.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ ...rule, days: on ? rule.days.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || rule.days.includes(x)) })}
              className={cn(
                "h-8 w-11 rounded-md border text-xs font-medium capitalize transition-colors",
                on ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ScheduleDialog({ vm, open, onOpenChange }: { vm: VirtualMachine; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const qc = useQueryClient();
  const existing = parseSchedule(vm.metadata.annotations?.[SCHEDULE_ANNOTATION]);
  const [sched, setSched] = useState<PowerSchedule>(
    existing ?? {
      enabled: true,
      timezone: ZONES.includes(localZone) ? localZone : "UTC",
      rules: SCHEDULE_PRESETS[0]?.rules.map((r) => ({ ...r, days: [...r.days] })) ?? [],
    },
  );
  const valid = sched.rules.length > 0 && sched.rules.every((r) => /^\d\d:\d\d$/.test(r.at) && r.days.length);
  const save = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].vms[":name"].schedule.$put({ param: { ns, name }, json: sched })),
    onSuccess: (v) => {
      qc.setQueryData(["vm", ns, name], v);
      toast.success("Power schedule saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const runs = valid ? nextRuns(sched, new Date(), 4) : [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" /> Power schedule
          </DialogTitle>
          <DialogDescription>
            Turn {vm.spec.displayName || name} on and off automatically. The console applies the rule within a minute of the set time.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {SCHEDULE_PRESETS.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                title={p.description}
                onClick={() => setSched({ ...sched, rules: p.rules.map((r) => ({ ...r, days: [...r.days] })) })}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-2">
            {sched.rules.map((r, i) => (
              <RuleEditor
                key={i}
                rule={r}
                onChange={(nr) => setSched({ ...sched, rules: sched.rules.map((x, j) => (j === i ? nr : x)) })}
                onRemove={() => setSched({ ...sched, rules: sched.rules.filter((_, j) => j !== i) })}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-start"
              disabled={sched.rules.length >= 8}
              onClick={() => setSched({ ...sched, rules: [...sched.rules, { action: "stop", at: "20:00", days: ["mon", "tue", "wed", "thu", "fri"] }] })}
            >
              <Plus /> Add rule
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Time zone</Label>
              <Select value={sched.timezone} onValueChange={(v) => setSched({ ...sched, timezone: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([localZone, ...ZONES])].map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                      {z === localZone ? " (your browser)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 self-end rounded-lg border px-3 py-2 text-sm">
              Enabled
              <Switch checked={sched.enabled} onCheckedChange={(v) => setSched({ ...sched, enabled: v })} />
            </label>
          </div>
          {runs.length > 0 && (
            <div className="bg-muted/40 rounded-lg border px-3 py-2.5">
              <div className="text-muted-foreground mb-1.5 text-xs font-medium">Next runs (your local time)</div>
              <ul className="grid gap-1 text-sm">
                {runs.map((r) => (
                  <li key={`${r.at.toISOString()}${r.action}`} className="flex items-center gap-2">
                    {r.action === "start" ? <Power className="text-success size-3.5" /> : <PowerOff className="text-muted-foreground size-3.5" />}
                    <span className="tabular">{whenFmt.format(r.at)}</span>
                    <span className="text-muted-foreground">{r.action === "start" ? "power on" : "power off"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />} Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulePanel({ vm }: { vm: VirtualMachine }) {
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const sched = parseSchedule(vm.metadata.annotations?.[SCHEDULE_ANNOTATION]);
  const canEdit = can(ns, "virtualmachines", "patch");
  const remove = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].vms[":name"].schedule.$delete({ param: { ns, name } })),
    onSuccess: (v) => {
      qc.setQueryData(["vm", ns, name], v);
      toast.success("Power schedule removed");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const next = sched ? nextRuns(sched, new Date(), 1)[0] : undefined;
  return (
    <Section
      title="Power schedule"
      icon={<CalendarClock />}
      description={sched ? `${sched.enabled ? "Active" : "Disabled"} · ${sched.timezone}` : "Save energy and capacity by powering off idle hours"}
      actions={
        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => setOpen(true)}>
          {sched ? "Edit" : "Add schedule"}
        </Button>
      }
    >
      {sched ? (
        <div className="grid gap-3">
          <ul className="grid gap-1.5 text-sm">
            {sched.rules.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                {r.action === "start" ? <Power className="text-success size-3.5" /> : <PowerOff className="text-muted-foreground size-3.5" />}
                {describeRule(r)}
              </li>
            ))}
          </ul>
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
            <span>{next ? `Next: ${next.action === "start" ? "power on" : "power off"} ${whenFmt.format(next.at)}` : "No upcoming run"}</span>
            <Button variant="ghost" size="sm" className="text-destructive h-7" disabled={!canEdit || remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No schedule. Use a preset such as office hours or nightly shutdown.</p>
      )}
      {open && <ScheduleDialog vm={vm} open={open} onOpenChange={setOpen} />}
    </Section>
  );
}
