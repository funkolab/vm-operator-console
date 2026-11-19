import { z } from "zod";

/**
 * Power schedules, stored as a JSON annotation on the VirtualMachine (no extra
 * CRD). The console executes them with leader election; each change is a
 * regular spec.powerState patch so vm-operator remains the only actor on
 * Nutanix.
 */
export const SCHEDULE_ANNOTATION = "console.nutanix.com/power-schedule";
export const SCHEDULE_STATE_ANNOTATION = "console.nutanix.com/power-schedule-last-run";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PowerRuleSchema = z.object({
  action: z.enum(["start", "stop"]),
  /** Local time HH:MM in the schedule time zone. */
  at: z.string().regex(HHMM, "Use HH:MM (24h)"),
  days: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day"),
});
export type PowerRule = z.infer<typeof PowerRuleSchema>;

export const PowerScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  timezone: z.string().min(1).default("UTC"),
  rules: z.array(PowerRuleSchema).min(1).max(8),
});
export type PowerSchedule = z.infer<typeof PowerScheduleSchema>;

export const SCHEDULE_PRESETS: { id: string; label: string; description: string; rules: PowerRule[] }[] = [
  {
    id: "office-hours",
    label: "Office hours",
    description: "On at 08:00, off at 20:00, Monday to Friday",
    rules: [
      { action: "start", at: "08:00", days: ["mon", "tue", "wed", "thu", "fri"] },
      { action: "stop", at: "20:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    ],
  },
  {
    id: "nightly-off",
    label: "Off at night",
    description: "Off at 22:00 every day, on at 06:00",
    rules: [
      { action: "stop", at: "22:00", days: [...WEEKDAYS] },
      { action: "start", at: "06:00", days: [...WEEKDAYS] },
    ],
  },
  {
    id: "weekend-off",
    label: "Off on weekends",
    description: "Off Friday 19:00, on Monday 07:00",
    rules: [
      { action: "stop", at: "19:00", days: ["fri"] },
      { action: "start", at: "07:00", days: ["mon"] },
    ],
  },
  {
    id: "stop-daily",
    label: "Stop every evening",
    description: "Off at 19:00 every day; start manually when needed",
    rules: [{ action: "stop", at: "19:00", days: [...WEEKDAYS] }],
  },
];

export function parseSchedule(raw: string | undefined): PowerSchedule | undefined {
  if (!raw) return undefined;
  try {
    const r = PowerScheduleSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Wall-clock parts of `date` in a IANA time zone. */
export function zonedParts(date: Date, timeZone: string): { day: Weekday; minutes: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const day = String(parts.weekday).toLowerCase().slice(0, 3) as Weekday;
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute), ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The rule due at `now`: a rule fires once, at the first evaluation within
 * `graceMinutes` after its time. `lastRun` ("<ymd>T<HH:MM>/<action>") dedupes.
 */
export function dueRule(schedule: PowerSchedule, now: Date, lastRun: string | undefined, graceMinutes = 10): { rule: PowerRule; key: string } | undefined {
  if (!schedule.enabled) return undefined;
  const { day, minutes, ymd } = zonedParts(now, schedule.timezone);
  let best: { rule: PowerRule; key: string; at: number } | undefined;
  for (const rule of schedule.rules) {
    if (!rule.days.includes(day)) continue;
    const at = toMinutes(rule.at);
    if (minutes < at || minutes - at > graceMinutes) continue;
    const key = `${ymd}T${rule.at}/${rule.action}`;
    if (key === lastRun) continue;
    if (!best || at > best.at) best = { rule, key, at };
  }
  return best && { rule: best.rule, key: best.key };
}

/** Offset (minutes) between UTC and the wall clock of `timeZone` at `date`. */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** The UTC instant of wall time `hhmm` on the zoned calendar day `ymd`. */
function zonedInstant(ymd: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, 0) + toMinutes(hhmm) * 60_000;
  // Two passes settle DST transitions.
  let t = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  t = guess - zoneOffsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

/** Next occurrences of the schedule, for display. */
export function nextRuns(schedule: PowerSchedule, from: Date, count = 3): { action: PowerRule["action"]; at: Date }[] {
  if (!schedule.enabled) return [];
  const out: { action: PowerRule["action"]; at: Date }[] = [];
  for (let d = 0; d < 9; d++) {
    const z = zonedParts(new Date(from.getTime() + d * 86_400_000), schedule.timezone);
    for (const rule of schedule.rules) {
      if (!rule.days.includes(z.day)) continue;
      const at = zonedInstant(z.ymd, rule.at, schedule.timezone);
      if (at.getTime() >= from.getTime() && !out.some((o) => o.at.getTime() === at.getTime() && o.action === rule.action))
        out.push({ action: rule.action, at });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, count);
}

export function describeRule(r: PowerRule): string {
  const days =
    r.days.length === 7
      ? "every day"
      : r.days.length === 5 && WEEKDAYS.slice(0, 5).every((d) => r.days.includes(d))
        ? "weekdays"
        : r.days.length === 2 && r.days.includes("sat") && r.days.includes("sun")
          ? "weekends"
          : r.days.map((d) => d[0]?.toUpperCase() + d.slice(1)).join(", ");
  return `${r.action === "start" ? "Power on" : "Power off"} at ${r.at}, ${days}`;
}
