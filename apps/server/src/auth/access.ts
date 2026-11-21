import type { NamespaceAccess, PermissionMatrix, ResourceName, Verb, WorkspaceAccess } from "@console/shared";
import { type Identity, type KubeClient, R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { log } from "../log";

const DISPLAY_NAME = "kommander.mesosphere.io/display-name";
const DESCRIPTION = "kommander.mesosphere.io/description";

interface WorkspaceObject {
  metadata: { name: string; annotations?: Record<string, string>; deletionTimestamp?: string };
  spec?: { namespaceName?: string };
  status?: { namespaceRef?: { name?: string } };
}

export type WorkspaceInfo = Omit<WorkspaceAccess, "permissions">;

const GROUP_OF: Record<ResourceName, string> = {
  virtualmachines: "vmm.v4.nutanix.com",
  virtualmachineservices: "vmm.v4.nutanix.com",
  nutanixprismcontexts: "prism.v4.nutanix.com",
  configmaps: "",
  secrets: "",
  events: "",
};

/** The checks that build the UI permission matrix for one namespace. */
const MATRIX: [ResourceName, Verb[]][] = [
  ["virtualmachines", ["list", "get", "create", "update", "patch", "delete"]],
  ["virtualmachineservices", ["list", "create", "update", "delete"]],
  ["nutanixprismcontexts", ["list", "get", "create", "patch", "delete"]],
  ["configmaps", ["list", "create", "update", "delete"]],
  ["secrets", ["list", "create", "update", "get", "delete"]],
  ["events", ["list"]],
];

interface SAR {
  status?: { allowed?: boolean; reason?: string };
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

/**
 * Computes what a user may see and do. SubjectAccessReviews are issued with
 * the console ServiceAccount (requires create on subjectaccessreviews) and
 * evaluate the impersonated user's RBAC, so the namespace selector only
 * offers namespaces the user can actually work in. Without an identity
 * (AUTH_MODE=none) SelfSubjectAccessReviews evaluate the console's own
 * credentials.
 */
export class AccessService {
  private cache = new Map<string, CacheEntry<NamespaceAccess[]>>();
  private inflight = new Map<string, Promise<NamespaceAccess[]>>();
  private nsCache?: CacheEntry<string[]>;
  private wsCache?: CacheEntry<WorkspaceInfo[] | null>;

  constructor(
    private readonly sa: KubeClient,
    private readonly ttlMs: number,
    private readonly restrictTo: string[],
  ) {}

  private key(id: Identity | undefined) {
    if (!id) return "\u0000self";
    return `${id.user}|${[...id.groups].sort().join(",")}`;
  }

  invalidate(id?: Identity) {
    if (id) this.cache.delete(this.key(id));
    else this.cache.clear();
    this.nsCache = undefined;
    this.wsCache = undefined;
  }

  async check(id: Identity | undefined, verb: string, resource: ResourceName | "namespaces", namespace?: string): Promise<boolean> {
    const resourceAttributes = { namespace, verb, group: resource === "namespaces" ? "" : GROUP_OF[resource], resource };
    const res = id
      ? await this.sa.create<SAR>(R.subjectaccessreviews, undefined, {
          apiVersion: "authorization.k8s.io/v1",
          kind: "SubjectAccessReview",
          spec: { user: id.user, groups: id.groups, resourceAttributes },
        })
      : await this.sa.create<SAR>(R.selfsubjectaccessreviews, undefined, {
          apiVersion: "authorization.k8s.io/v1",
          kind: "SelfSubjectAccessReview",
          spec: { resourceAttributes },
        });
    return res.status?.allowed === true;
  }

  /**
   * Kommander workspaces, listed with the ServiceAccount (they hold no secret
   * and only name a namespace), or null when the cluster has no Workspace API:
   * each namespace then stands for a workspace.
   */
  async workspaceCatalog(): Promise<WorkspaceInfo[] | null> {
    if (this.wsCache && this.wsCache.expires > Date.now()) return this.wsCache.value;
    let value: WorkspaceInfo[] | null;
    try {
      const list = await this.sa.listAll<WorkspaceObject>(R.workspaces);
      value = list.items
        .filter((w) => !w.metadata.deletionTimestamp)
        .map((w) => {
          const ann = w.metadata.annotations ?? {};
          return {
            name: w.metadata.name,
            displayName: ann[DISPLAY_NAME] || w.metadata.name,
            description: ann[DESCRIPTION] || undefined,
            namespace: w.status?.namespaceRef?.name || w.spec?.namespaceName || "",
          };
        })
        .filter((w) => w.namespace)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      if (!value.length) value = null;
    } catch (e) {
      if (!isNotFound(e)) log.warn("Cannot list Kommander workspaces; falling back to namespaces", { error: String(e) });
      value = null;
    }
    this.wsCache = { value, expires: Date.now() + 30_000 };
    return value;
  }

  /** Workspaces the user can access: those whose namespace passed the access checks. */
  async workspaces(id: Identity | undefined): Promise<{ source: "kommander" | "namespaces"; workspaces: WorkspaceAccess[] }> {
    const [catalog, access] = await Promise.all([this.workspaceCatalog(), this.namespaces(id)]);
    if (!catalog)
      return { source: "namespaces", workspaces: access.map((a) => ({ name: a.name, displayName: a.name, namespace: a.name, permissions: a.permissions })) };
    const byNs = new Map(access.map((a) => [a.name, a.permissions]));
    return {
      source: "kommander",
      workspaces: catalog.flatMap((w) => {
        const permissions = byNs.get(w.namespace);
        return permissions ? [{ ...w, permissions }] : [];
      }),
    };
  }

  /** Candidate namespaces: those of the workspaces (else every namespace), limited to WATCH_NAMESPACES when set. */
  async candidateNamespaces(): Promise<string[]> {
    const catalog = await this.workspaceCatalog();
    if (catalog) {
      const value = [...new Set(catalog.map((w) => w.namespace))].sort();
      return this.restrictTo.length ? value.filter((n) => this.restrictTo.includes(n)) : value;
    }
    if (this.restrictTo.length) return this.restrictTo;
    if (this.nsCache && this.nsCache.expires > Date.now()) return this.nsCache.value;
    const list = await this.sa.listAll<{ metadata: { name: string; deletionTimestamp?: string } }>(R.namespaces);
    const value = list.items
      .filter((n) => !n.metadata.deletionTimestamp)
      .map((n) => n.metadata.name)
      .sort();
    this.nsCache = { value, expires: Date.now() + 30_000 };
    return value;
  }

  async clusterWide(id: Identity | undefined): Promise<boolean> {
    return this.check(id, "list", "virtualmachines");
  }

  /** Namespaces where the user can list VirtualMachines or ConfigMaps (templates), with their permission matrix. */
  async namespaces(id: Identity | undefined): Promise<NamespaceAccess[]> {
    const k = this.key(id);
    const hit = this.cache.get(k);
    if (hit && hit.expires > Date.now()) return hit.value;
    const running = this.inflight.get(k);
    if (running) return running;
    const p = this.compute(id).finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }

  private async compute(id: Identity | undefined): Promise<NamespaceAccess[]> {
    const started = Date.now();
    const candidates = await this.candidateNamespaces();
    const visible: NamespaceAccess[] = [];
    let idx = 0;
    const worker = async () => {
      while (idx < candidates.length) {
        const ns = candidates[idx++] as string;
        const [vm, cm] = await Promise.all([this.check(id, "list", "virtualmachines", ns), this.check(id, "list", "configmaps", ns)]);
        if (!vm && !cm) continue;
        const permissions: PermissionMatrix = {};
        const checks = MATRIX.flatMap(([res, verbs]) => verbs.map((v) => [res, v] as const));
        const results = await Promise.all(
          checks.map(([res, v]) => {
            if (res === "virtualmachines" && v === "list") return vm;
            if (res === "configmaps" && v === "list") return cm;
            return this.check(id, v, res, ns);
          }),
        );
        checks.forEach(([res, v], i) => {
          permissions[res] ??= {};
          (permissions[res] as Record<string, boolean>)[v] = results[i] as boolean;
        });
        visible.push({ name: ns, permissions });
      }
    };
    // Each worker issues up to ~20 reviews at once; 4 workers keep the burst within one connection's stream limit.
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
    visible.sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(this.key(id), { value: visible, expires: Date.now() + this.ttlMs });
    log.debug("Computed namespace access", { user: id?.user ?? "(self)", namespaces: visible.length, ms: Date.now() - started });
    return visible;
  }

  async can(id: Identity | undefined, ns: string, resource: ResourceName, verb: Verb): Promise<boolean> {
    const access = await this.namespaces(id);
    return access.find((a) => a.name === ns)?.permissions[resource]?.[verb] === true;
  }
}
