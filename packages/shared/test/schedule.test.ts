import { describe, expect, test } from "bun:test";
import { describeRule, dueRule, nextRuns, type PowerSchedule, parseSchedule, SCHEDULE_PRESETS, zonedParts } from "../src";

const office: PowerSchedule = { enabled: true, timezone: "Europe/Paris", rules: SCHEDULE_PRESETS[0]?.rules ?? [] };

describe("power schedules", () => {
  test("zoned parts follow the time zone", () => {
    // 2026-11-19 is a Thursday; 07:05 UTC = 08:05 in Paris (CET)
    const z = zonedParts(new Date("2026-11-19T07:05:00Z"), "Europe/Paris");
    expect(z).toEqual({ day: "thu", minutes: 8 * 60 + 5, ymd: "2026-11-19" });
  });

  test("a rule is due within the grace window, once", () => {
    const now = new Date("2026-11-19T07:03:00Z");
    const d = dueRule(office, now, undefined);
    expect(d?.rule.action).toBe("start");
    expect(d?.key).toBe("2026-11-19T08:00/start");
    expect(dueRule(office, now, d?.key)).toBeUndefined();
  });

  test("no rule outside the window or on excluded days", () => {
    expect(dueRule(office, new Date("2026-11-19T07:30:00Z"), undefined)).toBeUndefined();
    // Saturday 08:02 Paris
    expect(dueRule(office, new Date("2026-11-21T07:02:00Z"), undefined)).toBeUndefined();
  });

  test("disabled schedules never fire", () => {
    expect(dueRule({ ...office, enabled: false }, new Date("2026-11-19T07:01:00Z"), undefined)).toBeUndefined();
  });

  test("next runs are ordered and respect days", () => {
    const runs = nextRuns(office, new Date("2026-11-20T18:00:00Z"), 3); // Friday 19:00 Paris
    expect(runs.map((r) => r.action)).toEqual(["stop", "start", "stop"]);
    expect(runs[0]?.at.toISOString()).toBe("2026-11-20T19:00:00.000Z");
    expect(runs[1]?.at.toISOString()).toBe("2026-11-23T07:00:00.000Z");
  });

  test("parse and describe", () => {
    expect(parseSchedule("not json")).toBeUndefined();
    expect(parseSchedule(JSON.stringify({ rules: [{ action: "stop", at: "25:00", days: ["mon"] }] }))).toBeUndefined();
    expect(parseSchedule(JSON.stringify(office))?.timezone).toBe("Europe/Paris");
    expect(describeRule({ action: "stop", at: "20:00", days: ["mon", "tue", "wed", "thu", "fri"] })).toBe("Power off at 20:00, weekdays");
  });
});
