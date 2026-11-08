import type { z } from "zod";
import { Annotations } from "./constants";
import {
  type NutanixResourceRef,
  type VirtualMachine,
  VirtualMachineSchema,
  type VirtualMachineService,
  VirtualMachineServiceSchema,
  type VMDataDisk,
} from "./crd";
import { compareQuantity, isQuantity, parseQuantity } from "./quantity";

export interface ValidationIssue {
  /** JSON pointer into the object, e.g. /spec/compute/numSockets */
  path: string;
  message: string;
}

export function issuePath(path: readonly PropertyKey[]): string {
  return path.length ? `/${path.map((p) => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}` : "";
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: issuePath(i.path), message: i.message }));
}

const addrKey = (a?: { adapterType?: string; deviceIndex?: number }) => `${a?.adapterType ?? "SCSI"}.${a?.deviceIndex ?? 0}`;

function refIssues(ref: NutanixResourceRef | undefined | null, path: string, out: ValidationIssue[], label: string) {
  if (!ref) return;
  if (ref.type === "extId" && (!ref.extId || ref.name)) out.push({ path, message: `${label}: extId must be set (and name absent) when type=extId` });
  if (ref.type === "name" && (!ref.name || ref.extId)) out.push({ path, message: `${label}: name must be set (and extId absent) when type=name` });
  if (ref.type === "objectRef") out.push({ path, message: `${label}: objectRef is reserved; use extId or name` });
}

export type ValidationMode = "create" | "update" | "template";

export interface ValidateOptions {
  mode: ValidationMode;
  /** Previously stored object, used for transition rules on update. */
  old?: VirtualMachine;
}

export function isProvisioned(vm: VirtualMachine | undefined): boolean {
  return !!vm?.status?.externalID;
}

/**
 * Validates a VirtualMachine against its OpenAPI schema plus the CEL and
 * ValidatingAdmissionPolicy rules shipped with vm-operator, so users get
 * immediate field-level feedback before the API server is involved.
 */
export function validateVirtualMachine(input: unknown, opts: ValidateOptions): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parsed = VirtualMachineSchema.safeParse(input);
  if (!parsed.success) out.push(...zodIssues(parsed.error));
  const vm = (parsed.success ? parsed.data : input) as VirtualMachine;
  const spec = vm?.spec;
  if (!spec || typeof spec !== "object") return out;

  if (opts.mode !== "template" && !vm.metadata?.name && !vm.metadata?.generateName) out.push({ path: "/metadata/name", message: "Name is required" });

  // Spec-level CEL rule.
  if (!spec.compute?.numSockets) out.push({ path: "/spec/compute/numSockets", message: "numSockets is required" });
  if (spec.compute?.memorySize === undefined || spec.compute.memorySize === "")
    out.push({ path: "/spec/compute/memorySize", message: "memorySize is required" });
  else if (!isQuantity(spec.compute.memorySize) || parseQuantity(spec.compute.memorySize) <= 0)
    out.push({ path: "/spec/compute/memorySize", message: "memorySize must be a positive quantity (e.g. 4Gi)" });
  if (!spec.bootConfiguration) out.push({ path: "/spec/bootConfiguration", message: "bootConfiguration is required" });
  if (!spec.network) out.push({ path: "/spec/network", message: "network is required" });

  refIssues(spec.placement?.cluster, "/spec/placement/cluster", out, "Cluster");

  // Boot disk.
  const boot = spec.bootConfiguration?.bootDisk;
  if (!boot && opts.mode !== "update") out.push({ path: "/spec/bootConfiguration/bootDisk", message: "A boot disk is required at creation" });
  if (boot) {
    if (boot.source?.type === "Image" && !boot.source.image)
      out.push({ path: "/spec/bootConfiguration/bootDisk/source/image", message: "Boot image is required" });
    refIssues(boot.source?.image, "/spec/bootConfiguration/bootDisk/source/image", out, "Boot image");
    if (boot.diskSize !== undefined && (!isQuantity(boot.diskSize) || parseQuantity(boot.diskSize) <= 0))
      out.push({ path: "/spec/bootConfiguration/bootDisk/diskSize", message: "diskSize must be a positive quantity" });
  }
  const bootOrder = spec.bootConfiguration?.bootOrder ?? [];
  if (new Set(bootOrder).size !== bootOrder.length) out.push({ path: "/spec/bootConfiguration/bootOrder", message: "Boot order entries must be unique" });

  // Data disks.
  const disks = spec.storage?.dataDisks ?? [];
  const seen = new Map<string, string>();
  if (boot) seen.set(addrKey(boot.deviceProperties), "/spec/bootConfiguration/bootDisk/deviceProperties");
  disks.forEach((d, i) => {
    const p = `/spec/storage/dataDisks/${i}`;
    const key = addrKey(d.deviceProperties);
    if (key === "SCSI.0") out.push({ path: `${p}/deviceProperties`, message: "SCSI.0 is reserved for the boot disk; use deviceIndex ≥ 1" });
    else if (seen.has(key)) out.push({ path: `${p}/deviceProperties`, message: `Disk address ${key} is already used` });
    seen.set(key, p);
    if (!d.source && (d.diskSize === undefined || d.diskSize === ""))
      out.push({ path: `${p}/diskSize`, message: "diskSize is required for a blank data disk" });
    if (d.diskSize !== undefined && d.diskSize !== "" && (!isQuantity(d.diskSize) || parseQuantity(d.diskSize) <= 0))
      out.push({ path: `${p}/diskSize`, message: "diskSize must be a positive quantity" });
    if (d.source?.type === "Image" && !d.source.image) out.push({ path: `${p}/source/image`, message: "Image is required when the source type is Image" });
    refIssues(d.source?.image, `${p}/source/image`, out, "Image");
    refIssues(d.storageConfig?.storageContainer, `${p}/storageConfig/storageContainer`, out, "Storage container");
    if (d.storageConfig?.diskMode === "Flash" && !spec.storage?.flashMode)
      out.push({ path: `${p}/storageConfig/diskMode`, message: "A Flash data disk requires storage flash mode to be enabled" });
  });

  // CD-ROMs.
  const cdSeen = new Set<string>();
  (spec.storage?.cdroms ?? []).forEach((c, i) => {
    const key = addrKey(c);
    if (cdSeen.has(key)) out.push({ path: `/spec/storage/cdroms/${i}`, message: `CD-ROM address ${key} is already used` });
    cdSeen.add(key);
    refIssues(c.image, `/spec/storage/cdroms/${i}/image`, out, "ISO image");
  });

  // NICs.
  const nicNames = new Set<string>();
  (spec.network?.nics ?? []).forEach((n, i) => {
    if (nicNames.has(n.name)) out.push({ path: `/spec/network/nics/${i}/name`, message: `Duplicate NIC name "${n.name}"` });
    nicNames.add(n.name);
    refIssues(n.networkInfo?.subnet, `/spec/network/nics/${i}/networkInfo/subnet`, out, "Subnet");
  });

  // Guest customization.
  const gc = spec.guestCustomization;
  if (gc) {
    const hasSecret = !!gc.secretRef;
    const hasKV = !!gc.customKeyValues;
    if (hasSecret === hasKV) out.push({ path: "/spec/guestCustomization", message: "Exactly one of secretRef or customKeyValues must be set" });
    if (gc.secretRef && !gc.secretRef.name) out.push({ path: "/spec/guestCustomization/secretRef/name", message: "Secret name is required" });
    if (gc.secretRef?.namespace) out.push({ path: "/spec/guestCustomization/secretRef/namespace", message: "Cross-namespace secrets are not supported" });
  }

  // Categories.
  const catSeen = new Set<string>();
  (spec.categories ?? []).forEach((c, i) => {
    const k = `${c.key}=${c.value}`;
    if (catSeen.has(k)) out.push({ path: `/spec/categories/${i}`, message: `Duplicate category ${k}` });
    catSeen.add(k);
  });

  // BIOS UUID ownership.
  const recover = vm.metadata?.annotations?.[Annotations.recoverByBiosUUID] === "true";
  if (opts.mode === "template" && spec.biosUUID) out.push({ path: "/spec/biosUUID", message: "Templates cannot carry a BIOS UUID" });
  if (opts.mode === "create" && spec.biosUUID && !recover)
    out.push({ path: "/spec/biosUUID", message: "Setting biosUUID requires the recover-by-bios-uuid annotation (DR import)" });
  if (recover && !spec.biosUUID) out.push({ path: "/spec/biosUUID", message: "recover-by-bios-uuid=true requires spec.biosUUID" });

  if (opts.mode === "update" && opts.old) out.push(...transitionIssues(opts.old, vm));
  return out;
}

/** Deep equality that ignores key order and treats undefined like an absent key. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null);
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

const eq = deepEqual;

function coldAllowed(old: VirtualMachine, next: VirtualMachine) {
  return old.status?.powerState !== "On" || next.spec.powerState === "Off";
}

/** Transition rules from the vm-immutable-after-provision ValidatingAdmissionPolicy. */
export function transitionIssues(old: VirtualMachine, next: VirtualMachine): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (eq(old.spec, next.spec) || !isProvisioned(old)) return out;
  const o = old.spec;
  const n = next.spec;
  const cold = coldAllowed(old, next);
  const coldMsg = "requires the VM to be powered off (power it off, or set power state Off in the same change)";

  if (!eq(o.context, n.context)) out.push({ path: "/spec/context", message: "Context cannot change after provisioning" });
  if (!eq(o.placement?.cluster, n.placement?.cluster)) out.push({ path: "/spec/placement/cluster", message: "Cluster cannot change after provisioning" });
  if (!cold) {
    if ((n.compute?.numSockets ?? 0) < (o.compute?.numSockets ?? 0)) out.push({ path: "/spec/compute/numSockets", message: `Decreasing sockets ${coldMsg}` });
    if (!eq(o.compute?.numCoresPerSocket, n.compute?.numCoresPerSocket))
      out.push({ path: "/spec/compute/numCoresPerSocket", message: `Changing cores per socket ${coldMsg}` });
    if (!eq(o.compute?.numThreadsPerCore, n.compute?.numThreadsPerCore))
      out.push({ path: "/spec/compute/numThreadsPerCore", message: `Changing threads per core ${coldMsg}` });
    if (o.compute?.memorySize !== undefined && compareQuantity(n.compute?.memorySize, o.compute.memorySize) < 0)
      out.push({ path: "/spec/compute/memorySize", message: `Decreasing memory ${coldMsg}` });
  }
  const ob = o.bootConfiguration;
  const nb = n.bootConfiguration;
  if (!eq(ob?.bootType, nb?.bootType)) out.push({ path: "/spec/bootConfiguration/bootType", message: "Boot type cannot change after provisioning" });
  if (ob?.bootDisk && nb?.bootDisk) {
    if (!eq(ob.bootDisk.source, nb.bootDisk.source))
      out.push({ path: "/spec/bootConfiguration/bootDisk/source", message: "Boot disk source cannot change after provisioning" });
    if (!eq(ob.bootDisk.deviceProperties, nb.bootDisk.deviceProperties))
      out.push({
        path: "/spec/bootConfiguration/bootDisk/deviceProperties",
        message: "Boot disk address cannot change after provisioning",
      });
    if (ob.bootDisk.diskSize !== undefined && compareQuantity(nb.bootDisk.diskSize, ob.bootDisk.diskSize) < 0)
      out.push({ path: "/spec/bootConfiguration/bootDisk/diskSize", message: "Boot disk size can only increase" });
  }
  if (ob?.bootDisk && !nb?.bootDisk && next.metadata.annotations?.[Annotations.allowBootDiskDeletion] !== "true")
    out.push({
      path: "/spec/bootConfiguration/bootDisk",
      message: "Removing the boot disk requires explicit confirmation (allow-boot-disk-deletion)",
    });
  if (!eq(o.guestCustomization, n.guestCustomization))
    out.push({ path: "/spec/guestCustomization", message: "Guest customization cannot change after provisioning" });

  const oldDisks = new Map((o.storage?.dataDisks ?? []).map((d) => [addrKey(d.deviceProperties), d]));
  const newDisks = n.storage?.dataDisks ?? [];
  const provisionedAddrs = new Set((old.status?.disks ?? []).map((d) => addrKey(d.deviceProperties)));
  newDisks.forEach((d, i) => {
    const prev = oldDisks.get(addrKey(d.deviceProperties));
    const p = `/spec/storage/dataDisks/${i}`;
    if (!prev) {
      if (!cold && d.deviceProperties?.adapterType && d.deviceProperties.adapterType !== "SCSI")
        out.push({ path: p, message: `Adding a non-SCSI disk ${coldMsg}` });
      return;
    }
    if (prev.diskSize !== undefined && compareQuantity(d.diskSize, prev.diskSize) < 0)
      out.push({ path: `${p}/diskSize`, message: "Disk size can only increase" });
    if (!eq(prev.source, d.source)) out.push({ path: `${p}/source`, message: "Disk source cannot change after provisioning" });
    if (!eq(prev.storageConfig, d.storageConfig)) out.push({ path: `${p}/storageConfig`, message: "Storage configuration cannot change after provisioning" });
  });
  const removed = removedDataDisks(old, next);
  if (removed.length) {
    if (next.metadata.annotations?.[Annotations.allowDiskDeletion] !== "true")
      out.push({ path: "/spec/storage/dataDisks", message: "Removing a data disk requires explicit confirmation (allow-disk-deletion)" });
    if (!cold && removed.some((d) => d.deviceProperties?.adapterType !== "SCSI" && provisionedAddrs.has(addrKey(d.deviceProperties))))
      out.push({ path: "/spec/storage/dataDisks", message: `Removing a non-SCSI disk ${coldMsg}` });
  }
  if (!cold && !eq(cdromKeys(o), cdromKeys(n))) out.push({ path: "/spec/storage/cdroms", message: `Adding or removing a CD-ROM ${coldMsg}` });

  const oldNics = new Map((o.network?.nics ?? []).map((x) => [x.name, x]));
  (n.network?.nics ?? []).forEach((nic, i) => {
    const prev = oldNics.get(nic.name);
    if (prev && !eq(prev.networkInfo, nic.networkInfo))
      out.push({ path: `/spec/network/nics/${i}/networkInfo`, message: "A NIC's subnet or type cannot change once provisioned" });
  });
  return out;
}

const cdromKeys = (s: VirtualMachine["spec"]) => (s.storage?.cdroms ?? []).map((c) => addrKey(c)).sort();

export function removedDataDisks(old: VirtualMachine, next: VirtualMachine): VMDataDisk[] {
  const keep = new Set((next.spec.storage?.dataDisks ?? []).map((d) => addrKey(d.deviceProperties)));
  return (old.spec.storage?.dataDisks ?? []).filter((d) => !keep.has(addrKey(d.deviceProperties)));
}

export interface ChangeSummary {
  changed: boolean;
  /** Changes the VM must be powered off for. */
  requiresPowerOff: string[];
  dataDisksRemoved: VMDataDisk[];
  bootDiskRemoved: boolean;
}

/** Summarizes a day-2 edit so the UI can warn about power-off and destructive changes. */
export function summarizeChanges(old: VirtualMachine, next: VirtualMachine): ChangeSummary {
  const o = old.spec;
  const n = next.spec;
  const req: string[] = [];
  if ((n.compute?.numSockets ?? 0) < (o.compute?.numSockets ?? 0)) req.push("Decrease vCPU sockets");
  if (!eq(o.compute?.numCoresPerSocket, n.compute?.numCoresPerSocket)) req.push("Change cores per socket");
  if (!eq(o.compute?.numThreadsPerCore, n.compute?.numThreadsPerCore)) req.push("Change threads per core");
  if (o.compute?.memorySize !== undefined && compareQuantity(n.compute?.memorySize, o.compute.memorySize) < 0) req.push("Decrease memory");
  if (!eq(cdromKeys(o), cdromKeys(n))) req.push("Add or remove CD-ROM drives");
  const oldKeys = new Set((o.storage?.dataDisks ?? []).map((d) => addrKey(d.deviceProperties)));
  const newKeys = new Set((n.storage?.dataDisks ?? []).map((d) => addrKey(d.deviceProperties)));
  for (const d of n.storage?.dataDisks ?? [])
    if (!oldKeys.has(addrKey(d.deviceProperties)) && d.deviceProperties?.adapterType !== "SCSI") req.push(`Add ${addrKey(d.deviceProperties)} disk`);
  for (const d of o.storage?.dataDisks ?? [])
    if (!newKeys.has(addrKey(d.deviceProperties)) && d.deviceProperties?.adapterType !== "SCSI") req.push(`Remove ${addrKey(d.deviceProperties)} disk`);
  return {
    changed: !eq(o, n) || !eq(old.metadata.labels, next.metadata.labels),
    requiresPowerOff: req,
    dataDisksRemoved: removedDataDisks(old, next),
    bootDiskRemoved: !!o.bootConfiguration?.bootDisk && !n.bootConfiguration?.bootDisk,
  };
}

export function validateVirtualMachineService(input: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const parsed = VirtualMachineServiceSchema.safeParse(input);
  if (!parsed.success) out.push(...zodIssues(parsed.error));
  const svc = (parsed.success ? parsed.data : input) as VirtualMachineService;
  if (!svc?.spec) return out;
  if (!svc.metadata?.name) out.push({ path: "/metadata/name", message: "Name is required" });
  const ports = svc.spec.ports ?? [];
  if (ports.length > 1)
    ports.forEach((p, i) => {
      if (!p.name) out.push({ path: `/spec/ports/${i}/name`, message: "Port name is required when more than one port is declared" });
    });
  const names = new Set<string>();
  ports.forEach((p, i) => {
    if (p.name && names.has(p.name)) out.push({ path: `/spec/ports/${i}/name`, message: "Port names must be unique" });
    if (p.name) names.add(p.name);
  });
  if (svc.spec.headless && svc.spec.type && svc.spec.type !== "ClusterIP")
    out.push({ path: "/spec/headless", message: "Headless is only valid with type ClusterIP" });
  return out;
}
