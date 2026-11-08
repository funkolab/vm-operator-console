import {
  Annotations,
  type KubeObject,
  Labels,
  LabelValues,
  type StreamMessage,
  stripManagedFields,
  type VirtualMachine,
  type WatchKind,
} from "@console/shared";
import { type Identity, type KubeClient, type ListOptions, R, type ResourceType } from "../k8s/client";
import { Informer } from "../k8s/informer";
import { log } from "../log";
import type { VMService } from "../services/vms";

const KINDS: Record<WatchKind, { rt: ResourceType; opts?: ListOptions }> = {
  virtualmachines: { rt: R.virtualmachines },
  virtualmachineservices: { rt: R.virtualmachineservices },
  nutanixprismcontexts: { rt: R.nutanixprismcontexts },
  configmaps: { rt: R.configmaps, opts: { labelSelector: `${Labels.type}=${LabelValues.vmTemplate}` } },
  events: { rt: R.events },
};

interface Entry {
  informer: Informer<KubeObject>;
  refs: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const IDLE_MS = 30_000;

/**
 * Shares impersonated watches between the SSE sessions of the same user:
 * one informer per (identity, namespace, kind), reference counted and
 * stopped shortly after the last subscriber leaves. All watch traffic runs
 * with the user's identity, so the API server enforces RBAC on reads too.
 */
export class StreamHub {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly base: KubeClient,
    private readonly vms: VMService,
  ) {}

  private key(id: Identity | undefined, ns: string, kind: WatchKind) {
    return `${id ? `${id.user}|${[...id.groups].sort().join(",")}` : "\u0000self"}|${ns}|${kind}`;
  }

  get activeWatches() {
    return this.entries.size;
  }

  subscribe(id: Identity | undefined, ns: string, kind: WatchKind, onMessage: (m: StreamMessage) => void): () => void {
    const k = this.key(id, ns, kind);
    let entry = this.entries.get(k);
    if (!entry) {
      const { rt, opts } = KINDS[kind];
      const client = this.base.as(id);
      const informer = new Informer<KubeObject>(client, rt, ns, opts).start();
      if (kind === "virtualmachines")
        informer.subscribe((type, obj) => {
          const vm = obj as VirtualMachine;
          if (type !== "DELETED" && vm.metadata.annotations?.[Annotations.restartPending]) void this.vms.continueRestart(client, vm);
        });
      entry = { informer, refs: 0 };
      this.entries.set(k, entry);
      log.debug("Started watch", { user: id?.user, ns, kind });
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.refs++;
    const e = entry;
    const unsub = e.informer.subscribe((type, obj) => {
      const o = stripManagedFields(obj);
      onMessage({ kind, type, namespace: o.metadata.namespace ?? ns, name: o.metadata.name ?? "", object: o });
    });
    return () => {
      unsub();
      e.refs--;
      if (e.refs <= 0)
        e.idleTimer = setTimeout(() => {
          e.informer.stop();
          this.entries.delete(k);
          log.debug("Stopped idle watch", { user: id?.user, ns, kind });
        }, IDLE_MS);
    };
  }

  stopAll() {
    for (const e of this.entries.values()) {
      if (e.idleTimer) clearTimeout(e.idleTimer);
      e.informer.stop();
    }
    this.entries.clear();
  }
}
