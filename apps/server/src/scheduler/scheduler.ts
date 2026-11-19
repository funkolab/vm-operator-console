import { hostname } from "node:os";
import { Annotations, dueRule, parseSchedule, SCHEDULE_ANNOTATION, SCHEDULE_STATE_ANNOTATION, type VirtualMachine } from "@console/shared";
import { type KubeClient, R, type ResourceType } from "../k8s/client";
import { isConflict, isNotFound } from "../k8s/errors";
import { log } from "../log";

const LEASES: ResourceType = { group: "coordination.k8s.io", version: "v1", plural: "leases", namespaced: true };

interface Lease {
  metadata: { name: string; namespace?: string; resourceVersion?: string };
  spec?: { holderIdentity?: string; leaseDurationSeconds?: number; renewTime?: string; acquireTime?: string };
}

export interface SchedulerOptions {
  namespace: string;
  /** Namespaces to scan (empty = all the ServiceAccount can list). */
  namespaces: string[];
  intervalMs?: number;
  leaseSeconds?: number;
}

/**
 * Executes VM power schedules. Exactly one console replica runs schedules at
 * a time (Lease-based leader election). Schedules are opt-in annotations set
 * by users who can patch the VM; the console ServiceAccount applies them,
 * which is why the chart grants it patch on virtualmachines only when
 * scheduling is enabled.
 */
export class PowerScheduler {
  private readonly id = `${hostname()}-${process.pid}`;
  private timer?: ReturnType<typeof setInterval>;
  private leader = false;
  lastTick?: string;
  lastActions: { at: string; vm: string; action: string; ok: boolean; error?: string }[] = [];

  constructor(
    private readonly sa: KubeClient,
    private readonly opts: SchedulerOptions,
  ) {}

  get isLeader() {
    return this.leader;
  }

  start() {
    const every = this.opts.intervalMs ?? 30_000;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), every);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async acquire(): Promise<boolean> {
    const name = "vm-operator-console-scheduler";
    const ns = this.opts.namespace;
    const duration = this.opts.leaseSeconds ?? 60;
    const now = new Date();
    const micro = now.toISOString().replace("Z", "000Z");
    try {
      const lease = await this.sa.get<Lease>(LEASES, ns, name);
      const holder = lease.spec?.holderIdentity;
      const renewed = lease.spec?.renewTime ? Date.parse(lease.spec.renewTime) : 0;
      const expired = now.getTime() - renewed > (lease.spec?.leaseDurationSeconds ?? duration) * 1000;
      if (holder !== this.id && !expired) return false;
      await this.sa.replace(LEASES, ns, name, {
        ...lease,
        spec: {
          ...lease.spec,
          holderIdentity: this.id,
          leaseDurationSeconds: duration,
          renewTime: micro,
          ...(holder !== this.id ? { acquireTime: micro } : {}),
        },
      });
      return true;
    } catch (e) {
      if (isNotFound(e)) {
        try {
          await this.sa.create(LEASES, ns, {
            apiVersion: "coordination.k8s.io/v1",
            kind: "Lease",
            metadata: { name, namespace: ns },
            spec: { holderIdentity: this.id, leaseDurationSeconds: duration, acquireTime: micro, renewTime: micro },
          });
          return true;
        } catch {
          return false;
        }
      }
      if (!isConflict(e)) log.debug("Scheduler lease unavailable", { error: String(e) });
      return false;
    }
  }

  private async listScheduled(): Promise<VirtualMachine[]> {
    const scan = this.opts.namespaces.length ? this.opts.namespaces : [undefined];
    const out: VirtualMachine[] = [];
    for (const ns of scan) {
      try {
        const res = await this.sa.listAll<VirtualMachine>(R.virtualmachines, ns);
        out.push(...res.items.filter((v) => v.metadata.annotations?.[SCHEDULE_ANNOTATION]));
      } catch (e) {
        log.debug("Scheduler cannot list VMs", { ns, error: String(e) });
      }
    }
    return out;
  }

  async tick(now = new Date()) {
    this.lastTick = now.toISOString();
    this.leader = await this.acquire();
    if (!this.leader) return;
    for (const vm of await this.listScheduled()) {
      const ann = vm.metadata.annotations ?? {};
      const schedule = parseSchedule(ann[SCHEDULE_ANNOTATION]);
      if (!schedule) continue;
      if (Object.hasOwn(ann, Annotations.paused)) continue;
      const due = dueRule(schedule, now, ann[SCHEDULE_STATE_ANNOTATION]);
      if (!due) continue;
      const desired = due.rule.action === "start" ? "On" : "Off";
      const key = `${vm.metadata.namespace}/${vm.metadata.name}`;
      try {
        await this.sa.patch(
          R.virtualmachines,
          vm.metadata.namespace,
          vm.metadata.name as string,
          {
            metadata: { resourceVersion: vm.metadata.resourceVersion, annotations: { [SCHEDULE_STATE_ANNOTATION]: due.key } },
            ...(vm.spec.powerState === desired ? {} : { spec: { powerState: desired } }),
          },
          "merge",
        );
        log.info("Applied power schedule", { vm: key, action: due.rule.action, rule: due.key });
        this.record(key, due.rule.action, true);
        await this.event(
          vm,
          due.rule.action === "start" ? "ScheduledPowerOn" : "ScheduledPowerOff",
          `Power schedule: ${due.rule.action === "start" ? "power on" : "power off"} at ${due.rule.at} (${schedule.timezone})`,
        );
      } catch (e) {
        if (isConflict(e)) continue; // retried on the next tick with a fresh object
        log.warn("Power schedule failed", { vm: key, error: String(e) });
        this.record(key, due.rule.action, false, String(e));
      }
    }
  }

  /** Best effort: an Event on the VM makes scheduled actions visible in Activity and on the VM. */
  private async event(vm: VirtualMachine, reason: string, message: string) {
    const now = new Date().toISOString();
    try {
      await this.sa.create(R.events, vm.metadata.namespace, {
        apiVersion: "v1",
        kind: "Event",
        metadata: { generateName: `${vm.metadata.name}.schedule-`, namespace: vm.metadata.namespace },
        involvedObject: { apiVersion: vm.apiVersion, kind: "VirtualMachine", name: vm.metadata.name, namespace: vm.metadata.namespace, uid: vm.metadata.uid },
        reason,
        message,
        type: "Normal",
        source: { component: "vm-operator-console" },
        firstTimestamp: now,
        lastTimestamp: now,
        count: 1,
      });
    } catch (e) {
      log.debug("Cannot record schedule event", { error: String(e) });
    }
  }

  private record(vm: string, action: string, ok: boolean, error?: string) {
    this.lastActions.unshift({ at: new Date().toISOString(), vm, action, ok, error });
    this.lastActions.length = Math.min(this.lastActions.length, 50);
  }
}
