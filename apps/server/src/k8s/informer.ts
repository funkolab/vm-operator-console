import type { KubeObject } from "@console/shared";
import { log } from "../log";
import type { KubeClient, ListOptions, ResourceType, WatchEvent } from "./client";
import { KubeError } from "./errors";
import type { StreamHandle } from "./transport";

export type InformerEventType = "ADDED" | "MODIFIED" | "DELETED";
export type InformerListener<T> = (type: InformerEventType, obj: T) => void;

/**
 * List-then-watch loop with resourceVersion tracking, bookmarks and
 * automatic re-list on 410 Gone. Keeps an in-memory store keyed by
 * namespace/name. Runs with the client's identity (impersonated or not).
 */
export class Informer<T extends KubeObject> {
  private store = new Map<string, T>();
  private listeners = new Set<InformerListener<T>>();
  private handle?: StreamHandle;
  private stopped = false;
  private rv?: string;
  private backoff = 1000;
  private syncedPromise: Promise<void>;
  private resolveSynced!: () => void;
  private rejectSynced!: (e: unknown) => void;
  synced = false;
  lastError?: unknown;

  constructor(
    private readonly client: KubeClient,
    private readonly rt: ResourceType,
    private readonly namespace: string | undefined,
    private readonly opts: ListOptions = {},
  ) {
    this.syncedPromise = new Promise((res, rej) => {
      this.resolveSynced = res;
      this.rejectSynced = rej;
    });
    this.syncedPromise.catch(() => {});
  }

  static key(o: KubeObject) {
    return `${o.metadata.namespace ?? ""}/${o.metadata.name}`;
  }

  start(): this {
    void this.run();
    return this;
  }

  waitForSync(timeoutMs = 15_000): Promise<void> {
    return Promise.race([this.syncedPromise, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("Informer sync timed out")), timeoutMs))]);
  }

  list(): T[] {
    return [...this.store.values()];
  }

  get(namespace: string, name: string): T | undefined {
    return this.store.get(`${namespace}/${name}`);
  }

  subscribe(fn: InformerListener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(type: InformerEventType, obj: T) {
    for (const l of this.listeners) {
      try {
        l(type, obj);
      } catch (e) {
        log.warn("Informer listener failed", { error: String(e) });
      }
    }
  }

  private async relist() {
    const list = await this.client.listAll<T>(this.rt, this.namespace, this.opts);
    const next = new Map(list.items.map((o) => [Informer.key(o), o]));
    for (const [k, old] of this.store) if (!next.has(k)) this.emit("DELETED", old);
    for (const [k, o] of next) {
      const old = this.store.get(k);
      if (!old) this.emit("ADDED", o);
      else if (old.metadata.resourceVersion !== o.metadata.resourceVersion) this.emit("MODIFIED", o);
    }
    this.store = next;
    this.rv = list.metadata.resourceVersion;
  }

  private async run() {
    while (!this.stopped) {
      try {
        if (!this.rv) await this.relist();
        if (!this.synced) {
          this.synced = true;
          this.resolveSynced();
        }
        this.lastError = undefined;
        this.backoff = 1000;
        let gone = false;
        this.handle = await this.client.watch<T>(this.rt, this.namespace, { ...this.opts, resourceVersion: this.rv }, (e: WatchEvent<T>) => {
          if (e.type === "BOOKMARK") {
            this.rv = e.object.metadata.resourceVersion;
            return;
          }
          if (e.type === "ERROR") {
            const st = e.object as unknown as { code?: number };
            if (st.code === 410) gone = true;
            return;
          }
          const k = Informer.key(e.object);
          this.rv = e.object.metadata.resourceVersion;
          if (e.type === "DELETED") this.store.delete(k);
          else this.store.set(k, e.object);
          this.emit(e.type, e.object);
        });
        const status = await this.handle.status;
        if (status === 410) gone = true;
        else if (status >= 400) throw new KubeError(status, { message: `watch failed with HTTP ${status}` });
        await this.handle.done;
        if (gone) this.rv = undefined;
      } catch (e) {
        if (this.stopped) return;
        this.lastError = e;
        if (!this.synced && e instanceof KubeError && (e.status === 403 || e.status === 401 || e.status === 404)) {
          this.rejectSynced(e);
          this.stopped = true;
          return;
        }
        log.debug("Informer error, retrying", { resource: this.rt.plural, ns: this.namespace, error: String(e) });
        this.rv = undefined;
        await new Promise((r) => setTimeout(r, this.backoff));
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    }
  }

  stop() {
    this.stopped = true;
    this.handle?.close();
    this.listeners.clear();
  }
}
