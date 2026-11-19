import {
  type ConsumerSample,
  type InfraCluster,
  type Infrastructure,
  type InfraVM,
  METRIC_RANGES,
  type MetricPoint,
  type MetricRange,
  type NutanixPrismContext,
  ppmToPercent,
  summarizeVM,
  type TaskProgress,
  type TopConsumers,
  type VirtualMachine,
  type VMMetrics,
  type VMPlacement,
} from "@console/shared";
import type { Config } from "../config";
import { ApiError } from "../errors";
import { type KubeClient, R } from "../k8s/client";
import { log } from "../log";
import { type PcStatTuple, PrismClient, PrismError } from "./client";
import type { PrismService } from "./service";

interface CacheEntry {
  expires: number;
  value: Promise<unknown>;
}

export interface ResolvedVM {
  vm: VirtualMachine;
  ctx: NutanixPrismContext;
  client: PrismClient;
  extId: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (v: number | undefined, d = 1) => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d);

/** Converts one Prism Central VM stats tuple into a compact metric point. */
export function toMetricPoint(t: PcStatTuple, intervalSeconds: number): MetricPoint | undefined {
  const cpu = ppmToPercent(num(t.hypervisorCpuUsagePpm));
  const mem = ppmToPercent(num(t.memoryUsagePpm) ?? num(t.hypervisorMemoryUsagePpm));
  const iops = num(t.controllerNumIops) ?? num(t.hypervisorNumIops);
  if (cpu === undefined && mem === undefined && iops === undefined) return undefined;
  const latency = num(t.controllerAvgIoLatencyMicros) ?? num(t.hypervisorAvgIoLatencyMicros);
  const rx = num(t.hypervisorNumReceivedBytes);
  const tx = num(t.hypervisorNumTransmittedBytes);
  return {
    t: t.timestamp,
    cpu,
    mem,
    guestMem: ppmToPercent(num(t.guestMemoryUsagePpm)),
    iops,
    latencyMs: latency === undefined ? undefined : round(latency / 1000, 2),
    readKBps: num(t.controllerReadIoBandwidthKbps),
    writeKBps: num(t.controllerWriteIoBandwidthKbps),
    rxBps: rx === undefined ? undefined : Math.round(rx / intervalSeconds),
    txBps: tx === undefined ? undefined : Math.round(tx / intervalSeconds),
  };
}

function latest(points: MetricPoint[]): VMMetrics["current"] {
  const current: VMMetrics["current"] = {};
  for (const p of points) for (const [k, v] of Object.entries(p)) if (v !== undefined) (current as Record<string, unknown>)[k] = v;
  return current;
}

/**
 * Read-only Prism Central insights. Authorization always goes through the
 * user's impersonated client: reading a VM's metrics requires `get` on the
 * VirtualMachine and on its NutanixPrismContext. Prism credentials are then
 * read with the console ServiceAccount and never leave the server.
 */
export class InsightsService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prism: PrismService,
    private readonly cfg: Config,
  ) {}

  private cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;
    const value = fn();
    this.cache.set(key, { value, expires: Date.now() + ttlMs });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 2000) for (const [k, v] of this.cache) if (v.expires < Date.now()) this.cache.delete(k);
    return value;
  }

  async clientFor(user: KubeClient, ns: string, contextName: string): Promise<{ ctx: NutanixPrismContext; client: PrismClient }> {
    if (!this.cfg.PRISM_PROXY_ENABLED) throw new ApiError(404, "PrismProxyDisabled", "Prism Central insights are disabled");
    const ctx = await user.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, contextName);
    const creds = await this.prism.credentialsFor(ctx);
    return { ctx, client: new PrismClient(creds, this.cfg.PRISM_REQUEST_TIMEOUT_MS) };
  }

  /** Loads the VM with the user's identity, then resolves its Prism Central connection. */
  async resolveVM(user: KubeClient, ns: string, name: string): Promise<ResolvedVM> {
    const vm = await user.get<VirtualMachine>(R.virtualmachines, ns, name);
    const extId = vm.status?.externalID;
    if (!extId) throw new ApiError(409, "NotProvisioned", "The VM is not provisioned on Nutanix yet");
    let contextName = vm.status?.resolvedContextRef?.name ?? vm.spec.context?.name;
    if (!contextName) {
      const list = await user.list<NutanixPrismContext>(R.nutanixprismcontexts, ns);
      if (list.items.length !== 1) throw new ApiError(409, "ContextUnresolved", "The VM is not bound to a Prism Central context yet");
      contextName = list.items[0]?.metadata.name as string;
    }
    const { ctx, client } = await this.clientFor(user, ns, contextName);
    return { vm, ctx, client, extId };
  }

  private ctxKey(ctx: NutanixPrismContext) {
    return `${ctx.metadata.namespace}/${ctx.metadata.name}@${ctx.metadata.resourceVersion}`;
  }

  private soft<T extends { available: boolean; message?: string }>(e: unknown, fallback: Omit<T, "available" | "message">): T {
    if (e instanceof ApiError && e.status < 500 && e.code !== "CredentialNotFound" && e.code !== "CABundleNotFound") throw e;
    const message = e instanceof PrismError || e instanceof ApiError ? e.message : String(e);
    log.warn("Prism insight unavailable", { error: message });
    return { ...fallback, available: false, message } as T;
  }

  async metrics(user: KubeClient, ns: string, name: string, range: MetricRange): Promise<VMMetrics> {
    const { seconds, interval } = METRIC_RANGES[range];
    const r = await this.resolveVM(user, ns, name);
    try {
      return await this.cached(`metrics:${this.ctxKey(r.ctx)}:${r.extId}:${range}`, Math.min(60_000, interval * 500), async () => {
        const end = new Date();
        const start = new Date(end.getTime() - seconds * 1000);
        const tuples = await r.client.vmStats(r.extId, start, end, interval);
        const points = tuples
          .map((t) => toMetricPoint(t, interval))
          .filter((p): p is MetricPoint => !!p && Date.parse(p.t) >= start.getTime() - interval * 1000)
          .sort((a, b) => a.t.localeCompare(b.t));
        return { available: true, range, intervalSeconds: interval, points, current: latest(points) };
      });
    } catch (e) {
      return this.soft<VMMetrics>(e, { range, intervalSeconds: interval, points: [], current: {} });
    }
  }

  private async hostIndex(client: PrismClient, key: string) {
    return this.cached(`hosts:${key}`, 5 * 60_000, async () => new Map((await client.hosts()).map((h) => [h.extId, h])));
  }

  private async clusterIndex(client: PrismClient, key: string) {
    return this.cached(`clusters:${key}`, 5 * 60_000, async () => new Map((await client.clusters()).map((c) => [c.extId, c])));
  }

  async placement(user: KubeClient, ns: string, name: string): Promise<VMPlacement> {
    const r = await this.resolveVM(user, ns, name);
    const key = this.ctxKey(r.ctx);
    try {
      return await this.cached(`placement:${key}:${r.extId}`, 20_000, async () => {
        const [vm, hosts, clusters] = await Promise.all([r.client.vmConfig(r.extId), this.hostIndex(r.client, key), this.clusterIndex(r.client, key)]);
        if (!vm) return { available: false, message: "The VM was not found on Prism Central" };
        const host = vm.host?.extId ? hosts.get(vm.host.extId) : undefined;
        const cluster = vm.cluster?.extId ? clusters.get(vm.cluster.extId) : undefined;
        const ep = r.ctx.spec.endpoint;
        return {
          available: true,
          extId: vm.extId,
          nutanixName: vm.name,
          host: vm.host?.extId ? { extId: vm.host.extId, name: host?.hostName, cpuModel: host?.cpuModel } : undefined,
          cluster: vm.cluster?.extId ? { extId: vm.cluster.extId, name: cluster?.name } : undefined,
          powerState: vm.powerState,
          createTime: vm.createTime,
          machineType: vm.machineType,
          isLiveMigrateCapable: vm.isLiveMigrateCapable,
          project: vm.project?.extId ? { extId: vm.project.extId, name: vm.project.name } : undefined,
          protectionType: vm.protectionType,
          prismUrl: `https://${ep.address}:${ep.port ?? 9440}/console/#/vm-details/${vm.extId}`,
        };
      });
    } catch (e) {
      return this.soft<VMPlacement>(e, {});
    }
  }

  async task(user: KubeClient, ns: string, name: string): Promise<TaskProgress> {
    const r = await this.resolveVM(user, ns, name);
    const taskId = r.vm.status?.activeTask?.extId;
    if (!taskId) return { available: false, message: "No operation in progress" };
    try {
      return await this.cached(`task:${this.ctxKey(r.ctx)}:${taskId}`, 2_000, async () => {
        const t = await r.client.task(taskId);
        if (!t) return { available: false, message: "Task not found on Prism Central", extId: taskId };
        return {
          available: true,
          extId: taskId,
          status: t.status,
          progress: t.progressPercentage,
          operation: t.operation,
          description: t.operationDescription,
          createdTime: t.createdTime,
          startedTime: t.startedTime,
          completedTime: t.completedTime,
          errorMessages: [...(t.errorMessages ?? []).map((m) => m.message ?? ""), t.legacyErrorMessage ?? ""].filter(Boolean),
        };
      });
    } catch (e) {
      return this.soft<TaskProgress>(e, { extId: taskId });
    }
  }

  /**
   * Clusters and hosts behind a Prism Central context, with current usage and
   * the placement of every VM. VMs the user can see as VirtualMachines (in any
   * namespace they can list) are linked to their Kubernetes object.
   */
  async infrastructure(user: KubeClient, ns: string, contextName: string, visibleVMs: VirtualMachine[]): Promise<Infrastructure> {
    const { ctx, client } = await this.clientFor(user, ns, contextName);
    const key = this.ctxKey(ctx);
    const base = {
      context: { namespace: ns, name: contextName, address: ctx.spec.endpoint.address, pcVersion: ctx.status?.pcVersion },
      generatedAt: new Date().toISOString(),
    };
    try {
      const [clusters, hosts, placements] = await Promise.all([
        this.clusterIndex(client, key),
        this.hostIndex(client, key),
        this.cached(`placements:${key}`, 20_000, () => client.vmPlacements()),
      ]);
      const stats = await this.cached(`infra-stats:${key}`, 60_000, async () => {
        const entries = await Promise.all([
          ...[...clusters.keys()].map(async (c) => [c, await client.latestStats(c).catch(() => ({}))] as const),
          ...[...hosts.values()]
            .filter((h) => h.cluster?.uuid)
            .map(async (h) => [h.extId, await client.latestStats(h.cluster?.uuid as string, h.extId).catch(() => ({}))] as const),
        ]);
        return new Map<string, Record<string, number>>(entries);
      });
      const managed = new Map(visibleVMs.filter((v) => v.status?.externalID).map((v) => [v.status?.externalID as string, v]));
      const out = new Map<string, InfraCluster>();
      for (const c of clusters.values()) {
        const s = stats.get(c.extId) ?? {};
        out.set(c.extId, {
          extId: c.extId,
          name: c.name,
          nodes: c.nodes?.numberOfNodes ?? 0,
          cpuUsage: ppmToPercent(s.hypervisorCpuUsagePpm),
          memUsage: ppmToPercent(s.overallMemoryUsagePpm ?? s.aggregateHypervisorMemoryUsagePpm),
          memoryCapacityBytes: s.memoryCapacityBytes,
          memoryUsedBytes: s.overallMemoryUsageBytes,
          storageCapacityBytes: s.storageCapacityBytes,
          storageUsedBytes: s.storageUsageBytes,
          vcpusConfigured: s.aggregateVmConfiguredVcpus,
          cpuOvercommit: s.cpuOvercommitRatioPpm ? round(s.cpuOvercommitRatioPpm / 1e6, 2) : undefined,
          iops: s.controllerNumIops,
          latencyMs: s.controllerAvgIoLatencyUsecs ? round(s.controllerAvgIoLatencyUsecs / 1000, 2) : undefined,
          healthScore: s.healthCheckScore,
          hosts: [],
          unplaced: [],
        });
      }
      const hostEntries = new Map<string, InfraCluster["hosts"][number]>();
      for (const h of hosts.values()) {
        const cluster = h.cluster?.uuid ? out.get(h.cluster.uuid) : undefined;
        if (!cluster) continue;
        const s = stats.get(h.extId) ?? {};
        const entry = {
          extId: h.extId,
          name: h.hostName,
          cpuModel: h.cpuModel,
          cores: h.numberOfCpuCores,
          memoryBytes: h.memorySizeBytes,
          cpuUsage: ppmToPercent(s.hypervisorCpuUsagePpm),
          memUsage: ppmToPercent(s.overallMemoryUsagePpm ?? s.aggregateHypervisorMemoryUsagePpm),
          iops: s.controllerNumIops,
          vms: [] as InfraVM[],
        };
        cluster.hosts.push(entry);
        hostEntries.set(h.extId, entry);
      }
      let managedCount = 0;
      for (const p of placements) {
        const k8s = managed.get(p.extId);
        const vm: InfraVM = { extId: p.extId, nutanixName: p.name ?? p.extId, powerState: p.powerState };
        if (k8s) {
          managedCount++;
          const s = summarizeVM(k8s);
          vm.managed = { namespace: s.namespace, name: s.name, displayName: s.displayName, phase: s.phase };
        }
        const host = p.host?.extId ? hostEntries.get(p.host.extId) : undefined;
        if (host) host.vms.push(vm);
        else if (p.cluster?.extId) out.get(p.cluster.extId)?.unplaced.push(vm);
      }
      for (const c of out.values()) {
        c.hosts.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { numeric: true }));
        for (const h of c.hosts) h.vms.sort((a, b) => Number(!!b.managed) - Number(!!a.managed) || a.nutanixName.localeCompare(b.nutanixName));
      }
      return { ...base, available: true, clusters: [...out.values()], managedCount, totalVms: placements.length };
    } catch (e) {
      return this.soft<Infrastructure>(e, { ...base, clusters: [], managedCount: 0, totalVms: 0 });
    }
  }

  /** Live CPU/memory of up to `limit` running VMs, sorted by CPU usage. */
  async topConsumers(user: KubeClient, vms: VirtualMachine[], limit = 8): Promise<TopConsumers> {
    const running = vms.filter((v) => v.status?.externalID && v.status?.powerState === "On").slice(0, 40);
    if (!running.length) return { available: true, items: [] };
    const results = await Promise.all(
      running.map(async (vm): Promise<ConsumerSample | undefined> => {
        try {
          const m = await this.metrics(user, vm.metadata.namespace as string, vm.metadata.name as string, "1h");
          if (!m.available) return undefined;
          const s = summarizeVM(vm);
          return {
            namespace: s.namespace,
            name: s.name,
            displayName: s.displayName,
            cpu: m.current.cpu,
            mem: m.current.mem,
            iops: m.current.iops,
            spark: m.points.slice(-30).map((p) => p.cpu ?? 0),
          };
        } catch {
          return undefined;
        }
      }),
    );
    const items = results.filter((r): r is ConsumerSample => !!r).sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0));
    return { available: items.length > 0 || running.length === 0, message: items.length ? undefined : "Metrics unavailable", items: items.slice(0, limit) };
  }
}
