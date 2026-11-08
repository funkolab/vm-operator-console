import type { KubeList } from "@console/shared";
import { KubeError, type KubeStatus } from "./errors";
import type { StreamHandle, Transport } from "./transport";

export interface Identity {
  user: string;
  groups: string[];
}

export interface ResourceType {
  group: string; // "" for core
  version: string;
  plural: string;
  namespaced: boolean;
}

export const R = {
  virtualmachines: { group: "vmm.v4.nutanix.com", version: "v1alpha1", plural: "virtualmachines", namespaced: true },
  virtualmachineservices: {
    group: "vmm.v4.nutanix.com",
    version: "v1alpha1",
    plural: "virtualmachineservices",
    namespaced: true,
  },
  nutanixprismcontexts: {
    group: "prism.v4.nutanix.com",
    version: "v1alpha1",
    plural: "nutanixprismcontexts",
    namespaced: true,
  },
  configmaps: { group: "", version: "v1", plural: "configmaps", namespaced: true },
  secrets: { group: "", version: "v1", plural: "secrets", namespaced: true },
  events: { group: "", version: "v1", plural: "events", namespaced: true },
  services: { group: "", version: "v1", plural: "services", namespaced: true },
  namespaces: { group: "", version: "v1", plural: "namespaces", namespaced: false },
  endpointslices: { group: "discovery.k8s.io", version: "v1", plural: "endpointslices", namespaced: true },
  subjectaccessreviews: {
    group: "authorization.k8s.io",
    version: "v1",
    plural: "subjectaccessreviews",
    namespaced: false,
  },
  selfsubjectaccessreviews: {
    group: "authorization.k8s.io",
    version: "v1",
    plural: "selfsubjectaccessreviews",
    namespaced: false,
  },
  selfsubjectreviews: { group: "authentication.k8s.io", version: "v1", plural: "selfsubjectreviews", namespaced: false },
} satisfies Record<string, ResourceType>;

export type PatchType = "merge" | "json" | "strategic" | "apply";
const PATCH_CT: Record<PatchType, string> = {
  merge: "application/merge-patch+json",
  json: "application/json-patch+json",
  strategic: "application/strategic-merge-patch+json",
  apply: "application/apply-patch+yaml",
};

export interface ListOptions {
  labelSelector?: string;
  fieldSelector?: string;
  limit?: number;
  continue?: string;
  resourceVersion?: string;
}

export interface WriteOptions {
  dryRun?: boolean;
  fieldManager?: string;
}

export interface WatchEvent<T> {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";
  object: T;
}

export const FIELD_MANAGER = "vm-operator-console";

export function resourcePath(rt: ResourceType, namespace?: string, name?: string, sub?: string): string {
  const base = rt.group ? `/apis/${rt.group}/${rt.version}` : `/api/${rt.version}`;
  const ns = rt.namespaced && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
  const n = name ? `/${encodeURIComponent(name)}` : "";
  return `${base}${ns}/${rt.plural}${n}${sub ? `/${sub}` : ""}`;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

/**
 * Kubernetes API client. When `identity` is set every request carries
 * Impersonate-User / Impersonate-Group headers, so the API server enforces
 * the end user's RBAC and records them in the audit log.
 */
export class KubeClient {
  constructor(
    private readonly transport: Transport,
    readonly identity?: Identity,
    private readonly timeoutMs = 30_000,
  ) {}

  as(identity: Identity | undefined): KubeClient {
    return new KubeClient(this.transport, identity, this.timeoutMs);
  }

  private headers(extra?: Record<string, string>): Record<string, string | string[]> {
    const h: Record<string, string | string[]> = { ...extra };
    if (this.identity) {
      h["impersonate-user"] = this.identity.user;
      if (this.identity.groups.length) h["impersonate-group"] = this.identity.groups;
    }
    return h;
  }

  async raw<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
    const res = await this.transport.request({
      method,
      path,
      headers: this.headers(body !== undefined ? { "content-type": contentType } : undefined),
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = { message: res.body };
    }
    if (res.status >= 400 || res.status === 0) throw new KubeError(res.status, (parsed as KubeStatus) ?? { message: `HTTP ${res.status}` });
    return parsed as T;
  }

  list<T>(rt: ResourceType, namespace?: string, opts: ListOptions = {}): Promise<KubeList<T>> {
    return this.raw("GET", resourcePath(rt, namespace) + qs({ ...opts }));
  }

  /** Lists every page. */
  async listAll<T>(rt: ResourceType, namespace?: string, opts: ListOptions = {}): Promise<KubeList<T>> {
    const items: T[] = [];
    let cont: string | undefined;
    let rv: string | undefined;
    do {
      const page = await this.list<T>(rt, namespace, { limit: 500, ...opts, continue: cont });
      items.push(...page.items);
      cont = page.metadata.continue;
      rv = page.metadata.resourceVersion;
    } while (cont);
    return { metadata: { resourceVersion: rv }, items };
  }

  get<T>(rt: ResourceType, namespace: string | undefined, name: string): Promise<T> {
    return this.raw("GET", resourcePath(rt, namespace, name));
  }

  create<T>(rt: ResourceType, namespace: string | undefined, obj: unknown, opts: WriteOptions = {}): Promise<T> {
    return this.raw(
      "POST",
      resourcePath(rt, namespace) + qs({ dryRun: opts.dryRun ? "All" : undefined, fieldManager: opts.fieldManager ?? FIELD_MANAGER }),
      obj,
    );
  }

  replace<T>(rt: ResourceType, namespace: string | undefined, name: string, obj: unknown, opts: WriteOptions = {}): Promise<T> {
    return this.raw(
      "PUT",
      resourcePath(rt, namespace, name) + qs({ dryRun: opts.dryRun ? "All" : undefined, fieldManager: opts.fieldManager ?? FIELD_MANAGER }),
      obj,
    );
  }

  patch<T>(
    rt: ResourceType,
    namespace: string | undefined,
    name: string,
    patch: unknown,
    type: PatchType = "merge",
    opts: WriteOptions & { force?: boolean; subresource?: string } = {},
  ): Promise<T> {
    return this.raw(
      "PATCH",
      resourcePath(rt, namespace, name, opts.subresource) +
        qs({
          dryRun: opts.dryRun ? "All" : undefined,
          fieldManager: opts.fieldManager ?? FIELD_MANAGER,
          force: type === "apply" ? (opts.force ?? true) : undefined,
        }),
      patch,
      PATCH_CT[type],
    );
  }

  delete<T = KubeStatus>(
    rt: ResourceType,
    namespace: string | undefined,
    name: string,
    opts: { dryRun?: boolean; propagationPolicy?: "Foreground" | "Background" | "Orphan"; resourceVersion?: string } = {},
  ): Promise<T> {
    const body: Record<string, unknown> = { apiVersion: "v1", kind: "DeleteOptions" };
    if (opts.propagationPolicy) body.propagationPolicy = opts.propagationPolicy;
    if (opts.resourceVersion) body.preconditions = { resourceVersion: opts.resourceVersion };
    return this.raw("DELETE", resourcePath(rt, namespace, name) + qs({ dryRun: opts.dryRun ? "All" : undefined }), body);
  }

  /**
   * Opens a watch. Events are delivered through `onEvent`; the returned handle
   * closes the stream. The caller handles reconnection (see Informer).
   */
  async watch<T>(
    rt: ResourceType,
    namespace: string | undefined,
    opts: ListOptions & { allowWatchBookmarks?: boolean; timeoutSeconds?: number },
    onEvent: (e: WatchEvent<T>) => void,
  ): Promise<StreamHandle> {
    const path =
      resourcePath(rt, namespace) +
      qs({
        watch: true,
        labelSelector: opts.labelSelector,
        fieldSelector: opts.fieldSelector,
        resourceVersion: opts.resourceVersion,
        allowWatchBookmarks: opts.allowWatchBookmarks ?? true,
        timeoutSeconds: opts.timeoutSeconds ?? 300,
      });
    return this.transport.stream({ method: "GET", path, headers: this.headers() }, (line) => {
      try {
        onEvent(JSON.parse(line) as WatchEvent<T>);
      } catch {
        /* ignore malformed line */
      }
    });
  }
}
