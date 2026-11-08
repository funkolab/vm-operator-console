import type { NamespaceAccess, PermissionMatrix, ResourceName, Verb } from "@console/shared";
import { type Identity, type KubeClient, R } from "../k8s/client";
import { log } from "../log";

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

  /** Candidate namespaces: WATCH_NAMESPACES, else every namespace (listed by the SA). */
  async candidateNamespaces(): Promise<string[]> {
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
