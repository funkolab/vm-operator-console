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

/** Read-only Prism Central v4 REST client used for catalog pickers and connection tests. */
export class PrismClient {
  constructor(
    private readonly creds: PrismCredentials,
    private readonly timeoutMs = 15_000,
  ) {}

  private get baseUrl() {
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
    }
    if (res.status === 401 || res.status === 403) throw new PrismError("Authentication failed: invalid credentials or insufficient privileges", res.status);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PrismError(`Prism Central returned HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
    }
    return (await res.json()) as T;
  }

  private async listAll<T>(path: string, max = 1000): Promise<T[]> {
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
}
