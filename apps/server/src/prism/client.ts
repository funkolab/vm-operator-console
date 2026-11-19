import type { CatalogItem, CatalogKind } from "@console/shared";

export interface PrismCredentials {
  address: string;
  port: number;
  insecure: boolean;
  caBundle?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export class PrismError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

interface V4List<T> {
  data?: T[];
  metadata?: { totalAvailableResults?: number };
}

interface Ref {
  extId?: string;
  name?: string;
}

/** Counting semaphore limiting concurrent requests to one Prism Central. */
class Gate {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.queue.push(r));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active--;
  }
}

const gates = new Map<string, Gate>();
const gateFor = (baseUrl: string) => {
  let g = gates.get(baseUrl);
  if (!g) gates.set(baseUrl, (g = new Gate(Number(process.env.PRISM_MAX_CONCURRENCY ?? 4))));
  return g;
};

/** Read-only Prism Central v4 REST client used for catalog pickers and connection tests. */
export class PrismClient {
  constructor(
    private readonly creds: PrismCredentials,
    private readonly timeoutMs = 15_000,
  ) {}

  get baseUrl() {
    const host = this.creds.address.includes(":") && !this.creds.address.startsWith("[") ? `[${this.creds.address}]` : this.creds.address;
    return `https://${host}:${this.creds.port}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (this.creds.apiKey) h["X-ntnx-api-key"] = this.creds.apiKey;
    else if (this.creds.username) h.authorization = `Basic ${Buffer.from(`${this.creds.username}:${this.creds.password ?? ""}`).toString("base64")}`;
    return h;
  }

  async get<T>(path: string): Promise<T> {
    // Prism Central's API gateway rate-limits clients (HTTP 429): limit the
    // concurrency per Prism Central and retry with backoff.
    const gate = gateFor(this.baseUrl);
    for (let attempt = 0; ; attempt++) {
      await gate.acquire();
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(this.timeoutMs),
          tls: this.creds.insecure ? { rejectUnauthorized: false } : { ca: this.creds.caBundle, rejectUnauthorized: true },
        } as RequestInit);
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.name === "TimeoutError") throw new PrismError(`Timed out connecting to ${this.creds.address}:${this.creds.port}`);
        throw new PrismError(`Cannot reach Prism Central: ${err.code ?? ""} ${err.message}`.trim());
      } finally {
        gate.release();
      }
      if (res.status === 429 && attempt < 4) {
        await res.body?.cancel();
        const retryAfter = Number(res.headers.get("retry-after"));
        await Bun.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new PrismError("Authentication failed: invalid credentials or insufficient privileges", res.status);
      if (res.status === 429) throw new PrismError("Prism Central is rate limiting requests; try again in a moment", 429);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new PrismError(`Prism Central returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
      }
      return (await res.json()) as T;
    }
  }

  async listAll<T>(path: string, max = 1000): Promise<T[]> {
    const out: T[] = [];
    const limit = 100;
    for (let page = 0; out.length < max; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const res = await this.get<V4List<T>>(`${path}${sep}$page=${page}&$limit=${limit}`);
      const data = res.data ?? [];
      out.push(...data);
      const total = res.metadata?.totalAvailableResults ?? 0;
      if (data.length < limit || out.length >= total) break;
    }
    return out;
  }

  async version(): Promise<string | undefined> {
    try {
      const res = await this.get<V4List<{ config?: { buildInfo?: { version?: string } } }>>("/api/prism/v4.0/config/domain-managers");
      return res.data?.[0]?.config?.buildInfo?.version;
    } catch (e) {
      // The domain manager API needs PC 2024.3+; older PCs list themselves among the clusters.
      if (!(e instanceof PrismError) || e.status !== 404) throw e;
      const res =
        await this.get<V4List<{ config?: { clusterFunction?: string[]; buildInfo?: { version?: string } } }>>("/api/clustermgmt/v4.0/config/clusters");
      return res.data?.find((c) => c.config?.clusterFunction?.includes("PRISM_CENTRAL"))?.config?.buildInfo?.version;
    }
  }

  async catalog(kind: CatalogKind): Promise<CatalogItem[]> {
    switch (kind) {
      case "clusters": {
        const items = await this.listAll<{ extId: string; name: string; config?: { clusterFunction?: string[] }; nodes?: { numberOfNodes?: number } }>(
          "/api/clustermgmt/v4.0/config/clusters",
        );
        return items
          .filter((c) => !c.config?.clusterFunction?.includes("PRISM_CENTRAL"))
          .map((c) => ({ extId: c.extId, name: c.name, info: c.nodes?.numberOfNodes ? { nodes: String(c.nodes.numberOfNodes) } : undefined }));
      }
      case "subnets": {
        const items = await this.listAll<{
          extId: string;
          name: string;
          subnetType?: string;
          networkId?: number;
          clusterReference?: string;
          clusterName?: string;
          description?: string;
        }>("/api/networking/v4.0/config/subnets");
        return items.map((s) => ({
          extId: s.extId,
          name: s.name,
          description: s.description,
          info: Object.fromEntries(
            Object.entries({ type: s.subnetType, vlan: s.networkId?.toString(), cluster: s.clusterName ?? s.clusterReference }).filter(
              ([, v]) => v !== undefined,
            ),
          ) as Record<string, string>,
        }));
      }
      case "images": {
        const items = await this.listAll<{ extId: string; name: string; type?: string; sizeBytes?: number; description?: string }>(
          "/api/vmm/v4.0/content/images",
        );
        return items.map((i) => ({
          extId: i.extId,
          name: i.name,
          description: i.description,
          info: Object.fromEntries(
            Object.entries({ type: i.type, size: i.sizeBytes ? `${Math.round(i.sizeBytes / 2 ** 30)} GiB` : undefined }).filter(([, v]) => v),
          ) as Record<string, string>,
        }));
      }
      case "storage-containers": {
        const items = await this.listAll<{ containerExtId?: string; extId?: string; name: string; clusterName?: string; clusterExtId?: string }>(
          "/api/clustermgmt/v4.0/config/storage-containers",
        );
        return items
          .filter((s) => !s.name.startsWith("NutanixManagementShare") && !s.name.startsWith("SelfServiceContainer"))
          .map((s) => ({
            extId: (s.containerExtId ?? s.extId) as string,
            name: s.name,
            info: s.clusterName ? { cluster: s.clusterName } : undefined,
          }));
      }
      case "categories": {
        const items = await this.listAll<{ extId: string; key: string; value: string; description?: string }>("/api/prism/v4.0/config/categories", 5000);
        return items.map((c) => ({ extId: c.extId, name: `${c.key}=${c.value}`, description: c.description, info: { key: c.key, value: c.value } }));
      }
      case "projects": {
        const items = await this.listAll<Ref & { description?: string }>("/api/multidomain/v4.0/config/projects");
        return items.map((p) => ({ extId: p.extId as string, name: p.name as string, description: p.description }));
      }
    }
  }

  /** TLS options for raw connections (websocket proxy). */
  get tls(): { rejectUnauthorized: boolean; ca?: string } {
    return this.creds.insecure ? { rejectUnauthorized: false } : { ca: this.creds.caBundle, rejectUnauthorized: true };
  }

  get authHeaders(): Record<string, string> {
    return this.headers();
  }

  /** Opens a Prism Central browser session (IAM cookies), used by the VNC websocket proxy. */
  async sessionCookie(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/nutanix/v3/users/me`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
        tls: this.tls,
      } as RequestInit);
    } catch (e) {
      throw new PrismError(`Cannot reach Prism Central: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new PrismError("Authentication failed", res.status);
    await res.body?.cancel();
    const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).filter(Boolean);
    return cookies.join("; ");
  }

  async vmConfig(extId: string): Promise<PcVm | undefined> {
    try {
      return (await this.get<{ data?: PcVm }>(`/api/vmm/v4.0/ahv/config/vms/${encodeURIComponent(extId)}`)).data;
    } catch (e) {
      if (e instanceof PrismError && e.status === 404) return undefined;
      throw e;
    }
  }

  /** Lightweight list of every VM with its placement (host/cluster). */
  async vmPlacements(): Promise<PcVm[]> {
    return this.listAll<PcVm>("/api/vmm/v4.0/ahv/config/vms?$select=extId,name,host,cluster,powerState", 5000);
  }

  async vmStats(extId: string, start: Date, end: Date, intervalSeconds: number): Promise<PcStatTuple[]> {
    const q = `$startTime=${start.toISOString().replace(/\.\d+Z$/, "Z")}&$endTime=${end.toISOString().replace(/\.\d+Z$/, "Z")}&$samplingInterval=${intervalSeconds}&$statType=AVG&$select=*`;
    const res = await this.get<{ data?: { stats?: PcStatTuple[] } }>(`/api/vmm/v4.0/ahv/stats/vms/${encodeURIComponent(extId)}?${q}`);
    return res.data?.stats ?? [];
  }

  async task(extId: string): Promise<PcTask | undefined> {
    try {
      return (await this.get<{ data?: PcTask }>(`/api/prism/v4.0/config/tasks/${encodeURIComponent(extId)}`)).data;
    } catch (e) {
      if (e instanceof PrismError && e.status === 404) return undefined;
      throw e;
    }
  }

  async clusters(): Promise<PcCluster[]> {
    return (await this.listAll<PcCluster>("/api/clustermgmt/v4.0/config/clusters")).filter((c) => !c.config?.clusterFunction?.includes("PRISM_CENTRAL"));
  }

  async hosts(): Promise<PcHost[]> {
    return this.listAll<PcHost>("/api/clustermgmt/v4.0/config/hosts");
  }

  /** Latest value of each time series for a cluster (or one of its hosts). */
  async latestStats(clusterExtId: string, hostExtId?: string): Promise<Record<string, number>> {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 60_000);
    const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");
    const path = `/api/clustermgmt/v4.0/stats/clusters/${encodeURIComponent(clusterExtId)}${hostExtId ? `/hosts/${encodeURIComponent(hostExtId)}` : ""}`;
    const res = await this.get<{ data?: Record<string, unknown> }>(
      `${path}?$startTime=${iso(start)}&$endTime=${iso(end)}&$samplingInterval=300&$statType=AVG&$select=*`,
    );
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(res.data ?? {})) {
      if (!Array.isArray(v) || !v.length) continue;
      const last = [...v].reverse().find((x: { value?: unknown }) => typeof x?.value === "number") as { value: number } | undefined;
      if (last) out[k] = last.value;
    }
    return out;
  }
}

export interface PcRef {
  extId?: string;
  name?: string;
}

export interface PcVm {
  extId: string;
  name?: string;
  host?: PcRef;
  cluster?: PcRef;
  powerState?: string;
  createTime?: string;
  machineType?: string;
  isLiveMigrateCapable?: boolean;
  project?: PcRef;
  protectionType?: string;
}

export type PcStatTuple = { timestamp: string } & Record<string, number | string | undefined>;

export interface PcTask {
  extId?: string;
  status?: string;
  progressPercentage?: number;
  operation?: string;
  operationDescription?: string;
  createdTime?: string;
  startedTime?: string;
  completedTime?: string;
  errorMessages?: { message?: string }[];
  legacyErrorMessage?: string;
}

export interface PcCluster {
  extId: string;
  name: string;
  config?: { clusterFunction?: string[] };
  nodes?: { numberOfNodes?: number };
}

export interface PcHost {
  extId: string;
  hostName?: string;
  cluster?: { uuid?: string; name?: string };
  cpuModel?: string;
  numberOfCpuCores?: number;
  memorySizeBytes?: number;
}
