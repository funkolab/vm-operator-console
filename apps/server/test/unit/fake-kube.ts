import type { KubeList } from "@console/shared";
import type { Identity, ListOptions, ResourceType, WriteOptions } from "../../src/k8s/client";
import { KubeClient } from "../../src/k8s/client";
import { KubeError } from "../../src/k8s/errors";
import type { Transport } from "../../src/k8s/transport";

type Obj = { metadata: { name?: string; namespace?: string; labels?: Record<string, string>; resourceVersion?: string; generation?: number } } & Record<
  string,
  unknown
>;

/** Records every call with the identity used, and lets tests decide who may do what. */
export interface Call {
  verb: string;
  plural: string;
  namespace?: string;
  name?: string;
  identity?: Identity;
  dryRun?: boolean;
  body?: unknown;
}

/**
 * In-memory stand-in for the Kubernetes API used by unit tests. It mimics
 * label selectors, resourceVersion bumps, 404/409 and an `authorize` hook
 * playing the role of RBAC for impersonated identities.
 */
export class FakeKube extends KubeClient {
  store = new Map<string, Obj>();
  calls: Call[] = [];
  authorize: (c: Call) => boolean = () => true;
  private rv = 1;

  constructor(
    id?: Identity,
    private readonly shared?: FakeKube,
  ) {
    super({} as Transport, id);
  }

  private get root(): FakeKube {
    return this.shared ?? this;
  }

  override as(id: Identity | undefined): KubeClient {
    return new FakeKube(id, this.root);
  }

  seed(plural: string, obj: Obj) {
    const r = this.root;
    obj.metadata.resourceVersion = String(r.rv++);
    obj.metadata.generation ??= 1;
    r.store.set(`${plural}/${obj.metadata.namespace ?? ""}/${obj.metadata.name}`, structuredClone(obj));
  }

  private record(c: Call) {
    const r = this.root;
    const call = { ...c, identity: this.identity };
    r.calls.push(call);
    if (!r.authorize(call)) throw new KubeError(403, { reason: "Forbidden", message: `forbidden: ${this.identity?.user} cannot ${c.verb} ${c.plural}` });
  }

  override async list<T>(rt: ResourceType, namespace?: string, opts: ListOptions = {}): Promise<KubeList<T>> {
    this.record({ verb: "list", plural: rt.plural, namespace });
    const sel = (opts.labelSelector ?? "").split(",").filter(Boolean);
    const items = [...this.root.store.entries()]
      .filter(([k]) => k.startsWith(`${rt.plural}/${namespace ?? ""}`))
      .map(([, v]) => v)
      .filter((o) =>
        sel.every((s) => {
          const [k, v] = s.split("=");
          return v === undefined ? o.metadata.labels?.[k as string] !== undefined : o.metadata.labels?.[k as string] === v;
        }),
      );
    return { metadata: {}, items: structuredClone(items) as T[] };
  }

  override listAll<T>(rt: ResourceType, namespace?: string, opts: ListOptions = {}) {
    return this.list<T>(rt, namespace, opts);
  }

  override async get<T>(rt: ResourceType, namespace: string | undefined, name: string): Promise<T> {
    this.record({ verb: "get", plural: rt.plural, namespace, name });
    const o = this.root.store.get(`${rt.plural}/${namespace ?? ""}/${name}`);
    if (!o) throw new KubeError(404, { reason: "NotFound", message: `${rt.plural} "${name}" not found` });
    return structuredClone(o) as T;
  }

  override async create<T>(rt: ResourceType, namespace: string | undefined, obj: unknown, opts: WriteOptions = {}): Promise<T> {
    const o = structuredClone(obj) as Obj;
    this.record({ verb: "create", plural: rt.plural, namespace, name: o.metadata.name, dryRun: opts.dryRun, body: o });
    const key = `${rt.plural}/${namespace ?? ""}/${o.metadata.name}`;
    if (this.root.store.has(key)) throw new KubeError(409, { reason: "AlreadyExists", message: `${rt.plural} "${o.metadata.name}" already exists` });
    o.metadata.namespace = namespace;
    o.metadata.resourceVersion = String(this.root.rv++);
    o.metadata.generation = 1;
    if (!opts.dryRun) this.root.store.set(key, o);
    return structuredClone(o) as T;
  }

  override async replace<T>(rt: ResourceType, namespace: string | undefined, name: string, obj: unknown, opts: WriteOptions = {}): Promise<T> {
    this.record({ verb: "update", plural: rt.plural, namespace, name, dryRun: opts.dryRun, body: obj });
    const key = `${rt.plural}/${namespace ?? ""}/${name}`;
    const cur = this.root.store.get(key);
    if (!cur) throw new KubeError(404, { reason: "NotFound", message: "not found" });
    const o = structuredClone(obj) as Obj;
    if (o.metadata.resourceVersion && o.metadata.resourceVersion !== cur.metadata.resourceVersion)
      throw new KubeError(409, { reason: "Conflict", message: "the object has been modified" });
    o.metadata.resourceVersion = String(this.root.rv++);
    o.metadata.generation = (cur.metadata.generation ?? 1) + 1;
    if (!opts.dryRun) this.root.store.set(key, o);
    return structuredClone(o) as T;
  }

  override async patch<T>(rt: ResourceType, namespace: string | undefined, name: string, patch: unknown): Promise<T> {
    this.record({ verb: "patch", plural: rt.plural, namespace, name, body: patch });
    const key = `${rt.plural}/${namespace ?? ""}/${name}`;
    const cur = this.root.store.get(key);
    if (!cur) throw new KubeError(404, { reason: "NotFound", message: "not found" });
    const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(b)) {
        if (v === null) delete a[k];
        else if (v && typeof v === "object" && !Array.isArray(v)) a[k] = merge((a[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
        else if (v !== undefined) a[k] = v;
      }
      return a;
    };
    const next = merge(structuredClone(cur), patch as Record<string, unknown>) as Obj;
    next.metadata.resourceVersion = String(this.root.rv++);
    this.root.store.set(key, next);
    return structuredClone(next) as T;
  }

  override async delete<T>(rt: ResourceType, namespace: string | undefined, name: string): Promise<T> {
    this.record({ verb: "delete", plural: rt.plural, namespace, name });
    const key = `${rt.plural}/${namespace ?? ""}/${name}`;
    if (!this.root.store.delete(key)) throw new KubeError(404, { reason: "NotFound", message: "not found" });
    return {} as T;
  }
}
