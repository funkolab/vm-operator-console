import {
  Annotations,
  ApiVersions,
  type BulkAction,
  type BulkResult,
  cleanVMForCopy,
  type KubeEvent,
  matchesSelector,
  type PowerAction,
  removedDataDisks,
  stripManagedFields,
  type VirtualMachine,
  type VirtualMachineService,
  validateVirtualMachine,
} from "@console/shared";
import { ApiError, validationError } from "../errors";
import { type KubeClient, R } from "../k8s/client";
import { isConflict, isNotFound } from "../k8s/errors";
import { log } from "../log";

export function sanitizeVMForCreate(vm: VirtualMachine, namespace: string): VirtualMachine {
  const { status: _s, ...rest } = vm;
  const meta = { ...vm.metadata };
  for (const k of ["uid", "resourceVersion", "generation", "creationTimestamp", "deletionTimestamp", "managedFields", "finalizers", "ownerReferences"] as const)
    delete meta[k];
  return { ...rest, apiVersion: ApiVersions.vmm, kind: "VirtualMachine", metadata: { ...meta, namespace } };
}

/** VirtualMachine operations. Every call uses the caller's impersonated client. */
export class VMService {
  async list(k: KubeClient, namespace?: string, labelSelector?: string): Promise<VirtualMachine[]> {
    const res = await k.listAll<VirtualMachine>(R.virtualmachines, namespace, { labelSelector });
    return res.items.map(stripManagedFields);
  }

  async get(k: KubeClient, ns: string, name: string): Promise<VirtualMachine> {
    return stripManagedFields(await k.get<VirtualMachine>(R.virtualmachines, ns, name));
  }

  async create(k: KubeClient, ns: string, input: VirtualMachine, opts: { dryRun?: boolean; user?: string } = {}): Promise<VirtualMachine> {
    const vm = sanitizeVMForCreate(input, ns);
    const issues = validateVirtualMachine(vm, { mode: "create" });
    if (issues.length) throw validationError(issues);
    if (opts.user) vm.metadata.annotations = { ...(vm.metadata.annotations ?? {}), [Annotations.createdBy]: opts.user };
    return stripManagedFields(await k.create<VirtualMachine>(R.virtualmachines, ns, vm, { dryRun: opts.dryRun }));
  }

  /**
   * Replaces the spec, labels and user annotations of a VM. Uses the
   * caller-supplied resourceVersion for optimistic concurrency.
   */
  async update(
    k: KubeClient,
    ns: string,
    name: string,
    input: VirtualMachine,
    opts: { dryRun?: boolean; user?: string; confirmDiskDeletion?: boolean; confirmBootDiskDeletion?: boolean } = {},
  ): Promise<VirtualMachine> {
    const current = await k.get<VirtualMachine>(R.virtualmachines, ns, name);
    // Optimistic concurrency on the user's intent: status-only writes by the
    // controller bump resourceVersion but not generation, so they must not
    // invalidate an edit. A spec change by someone else does.
    if (input.metadata.generation !== undefined && current.metadata.generation !== input.metadata.generation)
      throw new ApiError(409, "Conflict", "The VM was modified by someone else since you started editing. Reload to get the latest version.");
    const next: VirtualMachine = {
      ...current,
      metadata: {
        ...current.metadata,
        labels: input.metadata.labels,
        annotations: { ...(input.metadata.annotations ?? {}) },
      },
      spec: input.spec,
    };
    // Preserve controller-owned annotations the user may not edit.
    for (const [key, v] of Object.entries(current.metadata.annotations ?? {}))
      if (key.startsWith(Annotations.requestIdPrefix) || key === Annotations.recoveredByBiosUUID) next.metadata.annotations![key] = v;
    const ann = next.metadata.annotations!;
    if (opts.confirmDiskDeletion && removedDataDisks(current, next).length) ann[Annotations.allowDiskDeletion] = "true";
    if (opts.confirmBootDiskDeletion && current.spec.bootConfiguration?.bootDisk && !next.spec.bootConfiguration?.bootDisk)
      ann[Annotations.allowBootDiskDeletion] = "true";
    if (opts.user) ann[Annotations.updatedBy] = opts.user;
    const issues = validateVirtualMachine(next, { mode: "update", old: current });
    if (issues.length) throw validationError(issues);
    // Status is a subresource: PUT on the main resource ignores it.
    return stripManagedFields(await k.replace<VirtualMachine>(R.virtualmachines, ns, name, next, { dryRun: opts.dryRun }));
  }

  async patchMetadata(
    k: KubeClient,
    ns: string,
    name: string,
    patch: { labels?: Record<string, string | null>; annotations?: Record<string, string | null> },
  ): Promise<VirtualMachine> {
    return stripManagedFields(await k.patch<VirtualMachine>(R.virtualmachines, ns, name, { metadata: patch }, "merge"));
  }

  async delete(k: KubeClient, ns: string, name: string, opts: { dryRun?: boolean } = {}) {
    await k.delete(R.virtualmachines, ns, name, { dryRun: opts.dryRun, propagationPolicy: "Background" });
  }

  private async setPower(k: KubeClient, ns: string, name: string, powerState: "On" | "Off", extra: Record<string, string | null> = {}) {
    return k.patch<VirtualMachine>(
      R.virtualmachines,
      ns,
      name,
      { spec: { powerState }, metadata: Object.keys(extra).length ? { annotations: extra } : undefined },
      "merge",
    );
  }

  async power(k: KubeClient, ns: string, name: string, action: PowerAction): Promise<VirtualMachine> {
    switch (action) {
      case "start":
        return stripManagedFields(await this.setPower(k, ns, name, "On", { [Annotations.restartPending]: null }));
      case "stop":
        return stripManagedFields(await this.setPower(k, ns, name, "Off", { [Annotations.restartPending]: null }));
      case "pause":
        return this.patchMetadata(k, ns, name, { annotations: { [Annotations.paused]: "true" } });
      case "resume":
        return this.patchMetadata(k, ns, name, { annotations: { [Annotations.paused]: null } });
      case "restart": {
        const vm = await k.get<VirtualMachine>(R.virtualmachines, ns, name);
        if (!vm.status?.externalID) throw new ApiError(409, "NotProvisioned", "The VM is not provisioned yet");
        if (vm.metadata.annotations?.[Annotations.paused] !== undefined)
          throw new ApiError(409, "Paused", "Reconciliation is paused for this VM; resume it first");
        // The operator has no reboot primitive: power off, wait for Off, power on.
        // The restart-pending annotation lets any console replica resume the cycle.
        const updated = await this.setPower(k, ns, name, "Off", { [Annotations.restartPending]: new Date().toISOString() });
        return stripManagedFields(updated);
      }
    }
  }

  /**
   * Completes pending restarts: once a VM marked restart-pending is observed
   * Off, power it back On. Invoked from watch events (with the user's client).
   */
  async continueRestart(k: KubeClient, vm: VirtualMachine): Promise<boolean> {
    const pending = vm.metadata.annotations?.[Annotations.restartPending];
    if (!pending || vm.status?.powerState !== "Off" || vm.spec.powerState !== "Off" || vm.status.activeTask) return false;
    try {
      await k.patch(
        R.virtualmachines,
        vm.metadata.namespace,
        vm.metadata.name as string,
        {
          metadata: { resourceVersion: vm.metadata.resourceVersion, annotations: { [Annotations.restartPending]: null } },
          spec: { powerState: "On" },
        },
        "merge",
      );
      log.info("Completed VM restart", { ns: vm.metadata.namespace, name: vm.metadata.name });
      return true;
    } catch (e) {
      if (!isConflict(e) && !isNotFound(e)) log.warn("Could not complete VM restart", { error: String(e) });
      return false;
    }
  }

  async clone(
    k: KubeClient,
    ns: string,
    name: string,
    req: { name: string; namespace?: string; displayName?: string; powerState?: "On" | "Off"; spec?: Record<string, unknown> },
    user?: string,
  ): Promise<VirtualMachine> {
    const src = await k.get<VirtualMachine>(R.virtualmachines, ns, name);
    const copy = cleanVMForCopy(src);
    const targetNs = req.namespace ?? ns;
    if (req.spec) copy.spec = req.spec as VirtualMachine["spec"];
    copy.metadata = {
      ...copy.metadata,
      name: req.name,
      namespace: targetNs,
      annotations: { ...(copy.metadata.annotations ?? {}), [Annotations.clonedFrom]: `${ns}/${name}` },
    };
    if (!req.spec) {
      copy.spec.displayName = req.displayName || req.name;
      // Cross-namespace clones cannot reuse a namespace-local context reference.
      if (targetNs !== ns) delete copy.spec.context;
    }
    if (req.powerState) copy.spec.powerState = req.powerState;
    return this.create(k, targetNs, copy, { user });
  }

  async events(k: KubeClient, ns: string, name: string, uid?: string): Promise<KubeEvent[]> {
    const fieldSelector = [`involvedObject.name=${name}`, "involvedObject.kind=VirtualMachine", uid ? `involvedObject.uid=${uid}` : ""]
      .filter(Boolean)
      .join(",");
    const res = await k.list<KubeEvent>(R.events, ns, { fieldSelector });
    return res.items.map(stripManagedFields);
  }

  async servicesFor(k: KubeClient, vm: VirtualMachine): Promise<VirtualMachineService[]> {
    try {
      const res = await k.list<VirtualMachineService>(R.virtualmachineservices, vm.metadata.namespace);
      return res.items.filter((s) => matchesSelector(s.spec.selector, vm.metadata.labels)).map(stripManagedFields);
    } catch {
      return [];
    }
  }

  async bulk(k: KubeClient, action: BulkAction, user?: string): Promise<BulkResult> {
    const results = await Promise.all(
      action.targets.map(async (t) => {
        try {
          if (action.action === "delete") await this.delete(k, t.namespace, t.name);
          else if (action.action === "label") await this.patchMetadata(k, t.namespace, t.name, { labels: action.labels ?? {} });
          else await this.power(k, t.namespace, t.name, action.action);
          return { ...t, ok: true };
        } catch (e) {
          return { ...t, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    log.info("Bulk action", { user, action: action.action, count: results.length, failed: results.filter((r) => !r.ok).length });
    return { results };
  }
}
