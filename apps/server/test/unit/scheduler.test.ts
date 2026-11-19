import { describe, expect, test } from "bun:test";
import { SCHEDULE_ANNOTATION, SCHEDULE_STATE_ANNOTATION } from "@console/shared";
import { setLogLevel } from "../../src/log";
import { PowerScheduler } from "../../src/scheduler/scheduler";
import { FakeKube } from "./fake-kube";

setLogLevel("error");

const schedule = { enabled: true, timezone: "UTC", rules: [{ action: "stop", at: "20:00", days: ["mon", "tue", "wed", "thu", "fri"] }] };

function vm(name: string, extra: Record<string, string> = {}) {
  return {
    metadata: { name, namespace: "team-a", annotations: { [SCHEDULE_ANNOTATION]: JSON.stringify(schedule), ...extra } },
    spec: { powerState: "On" },
  };
}

describe("PowerScheduler", () => {
  test("leader applies due rules once and records the run", async () => {
    const kube = new FakeKube();
    kube.seed("virtualmachines", vm("web"));
    kube.seed("virtualmachines", vm("paused", { "infra.nutanix.com/paused": "true" }));
    const s = new PowerScheduler(kube, { namespace: "vm-console", namespaces: [] });
    const thursday20h05 = new Date("2026-11-19T20:05:00Z");
    await s.tick(thursday20h05);
    expect(s.isLeader).toBe(true);
    const web = kube.store.get("virtualmachines/team-a/web") as unknown as { spec: { powerState: string }; metadata: { annotations: Record<string, string> } };
    expect(web.spec.powerState).toBe("Off");
    expect(web.metadata.annotations[SCHEDULE_STATE_ANNOTATION]).toBe("2026-11-19T20:00/stop");
    const paused = kube.store.get("virtualmachines/team-a/paused") as unknown as { spec: { powerState: string } };
    expect(paused.spec.powerState).toBe("On");
    const ev = kube.calls.find((c) => c.verb === "create" && c.plural === "events")?.body as { reason: string; involvedObject: { name: string } };
    expect(ev.reason).toBe("ScheduledPowerOff");
    expect(ev.involvedObject.name).toBe("web");
    // Same window: nothing more happens even if the user powers the VM back on.
    web.spec.powerState = "On";
    await s.tick(new Date("2026-11-19T20:08:00Z"));
    expect((kube.store.get("virtualmachines/team-a/web") as unknown as { spec: { powerState: string } }).spec.powerState).toBe("On");
  });

  test("only one replica holds the lease", async () => {
    const kube = new FakeKube();
    const a = new PowerScheduler(kube, { namespace: "vm-console", namespaces: [] });
    await a.tick(new Date());
    const b = new PowerScheduler(kube, { namespace: "vm-console", namespaces: [] });
    // Same pid/host in tests: force a different identity.
    Object.defineProperty(b, "id", { value: "other-replica" });
    await b.tick(new Date());
    expect(a.isLeader).toBe(true);
    expect(b.isLeader).toBe(false);
  });
});
