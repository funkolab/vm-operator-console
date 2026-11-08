import { Annotations, Labels } from "./constants";
import type { NutanixResourceRef, VirtualMachine } from "./crd";
import { getCondition } from "./k8s";
import { parseQuantity } from "./quantity";

export type VMPhase =
  | "Pending"
  | "Provisioning"
  | "Running"
  | "Stopped"
  | "Starting"
  | "Stopping"
  | "Restarting"
  | "Updating"
  | "Deleting"
  | "Degraded"
  | "Error"
  | "Unknown";

export const VM_PHASES: VMPhase[] = [
  "Running",
  "Stopped",
  "Pending",
  "Provisioning",
  "Starting",
  "Stopping",
  "Restarting",
  "Updating",
  "Deleting",
  "Degraded",
  "Error",
  "Unknown",
];

export interface VMSummary {
  key: string;
  namespace: string;
  name: string;
  displayName: string;
  phase: VMPhase;
  powerState?: "On" | "Off";
  desiredPowerState: "On" | "Off";
  ready: "True" | "False" | "Unknown";
  readyReason?: string;
  readyMessage?: string;
  ipAddresses: string[];
  primaryIP?: string;
  cluster: string;
  context?: string;
  vcpus: number;
  memoryBytes: number;
  diskBytes: number;
  diskCount: number;
  nicCount: number;
  driftCount: number;
  activeTask?: string;
  paused: boolean;
  template?: string;
  externalID?: string;
  createdAt?: string;
  converging: boolean;
  labels: Record<string, string>;
}

export function refLabel(ref: NutanixResourceRef | undefined | null): string {
  if (!ref) return "—";
  if (ref.type === "name") return ref.name ?? "—";
  if (ref.type === "extId") return ref.extId ?? "—";
  return ref.objectRef?.name ?? "—";
}

const TASK_PHASE: Record<string, VMPhase> = {
  Create: "Provisioning",
  CreateFromTemplate: "Provisioning",
  PowerOn: "Starting",
  PowerOff: "Stopping",
  Delete: "Deleting",
};

const FAILURE_REASON = /(Failed|NotFound|Ambiguous|Unauthorized|Invalid|Error|Blocked)/;

export function vmPhase(vm: VirtualMachine): VMPhase {
  const st = vm.status;
  const conds = st?.conditions;
  if (vm.metadata.deletionTimestamp) return "Deleting";
  if (vm.metadata.annotations?.[Annotations.restartPending]) return "Restarting";
  if (st?.activeTask) return TASK_PHASE[st.activeTask.kind] ?? "Updating";
  const ready = getCondition(conds, "Ready");
  const failing = conds?.find((c) => c.status === "False" && c.type !== "Drifted" && FAILURE_REASON.test(c.reason ?? ""));
  if (!st?.externalID) {
    if (failing) return "Error";
    return conds?.length ? "Provisioning" : "Pending";
  }
  if (failing) return "Error";
  const desired = vm.spec.powerState ?? "On";
  if (st.powerState && st.powerState !== desired) return desired === "On" ? "Starting" : "Stopping";
  if (ready?.status === "False" && st.powerState === "On") return "Degraded";
  if (st.powerState === "On") return "Running";
  if (st.powerState === "Off") return "Stopped";
  return "Unknown";
}

export function vmIPs(vm: VirtualMachine): string[] {
  const ips = new Set<string>();
  const addrs = vm.status?.addresses ?? [];
  for (const src of ["Learned", "Assigned", undefined, "Secondary"]) for (const a of addrs) if (a.type.endsWith("IP") && a.source === src) ips.add(a.address);
  return [...ips];
}

export function vmVCPUs(vm: VirtualMachine): number {
  const c = vm.spec.compute;
  return (c?.numSockets ?? 0) * (c?.numCoresPerSocket ?? 1) * (c?.numThreadsPerCore ?? 1);
}

export function vmDiskBytes(vm: VirtualMachine): number {
  const observed = new Map((vm.status?.disks ?? []).map((d) => [`${d.deviceProperties.adapterType}.${d.deviceProperties.deviceIndex ?? 0}`, d.sizeBytes]));
  let total = 0;
  const boot = vm.spec.bootConfiguration?.bootDisk;
  if (boot?.diskSize !== undefined) total += parseQuantity(boot.diskSize) || 0;
  for (const d of vm.spec.storage?.dataDisks ?? []) {
    const key = `${d.deviceProperties?.adapterType ?? "SCSI"}.${d.deviceProperties?.deviceIndex ?? 0}`;
    total += observed.get(key) ?? (parseQuantity(d.diskSize ?? 0) || 0);
  }
  return total;
}

export function summarizeVM(vm: VirtualMachine): VMSummary {
  const ready = getCondition(vm.status?.conditions, "Ready");
  const ips = vmIPs(vm);
  const gen = vm.metadata.generation ?? 0;
  return {
    key: `${vm.metadata.namespace}/${vm.metadata.name}`,
    namespace: vm.metadata.namespace ?? "",
    name: vm.metadata.name ?? "",
    displayName: vm.spec.displayName || vm.metadata.name || "",
    phase: vmPhase(vm),
    powerState: vm.status?.powerState,
    desiredPowerState: vm.spec.powerState ?? "On",
    ready: ready?.status ?? "Unknown",
    readyReason: ready?.reason,
    readyMessage: ready?.message,
    ipAddresses: ips,
    primaryIP: ips[0],
    cluster: refLabel(vm.spec.placement?.cluster),
    context: vm.status?.resolvedContextRef?.name ?? vm.spec.context?.name,
    vcpus: vmVCPUs(vm),
    memoryBytes: parseQuantity(vm.spec.compute?.memorySize ?? 0) || 0,
    diskBytes: vmDiskBytes(vm),
    diskCount: (vm.spec.bootConfiguration?.bootDisk ? 1 : 0) + (vm.spec.storage?.dataDisks?.length ?? 0),
    nicCount: vm.spec.network?.nics?.length ?? 0,
    driftCount: vm.status?.drift?.length ?? 0,
    activeTask: vm.status?.activeTask?.kind,
    paused: Object.hasOwn(vm.metadata.annotations ?? {}, Annotations.paused),
    template: vm.metadata.labels?.[Labels.template],
    externalID: vm.status?.externalID,
    createdAt: vm.metadata.creationTimestamp ?? undefined,
    converging: !!vm.status && gen > 0 && (vm.status.appliedGeneration ?? 0) < gen,
    labels: vm.metadata.labels ?? {},
  };
}

/** Annotations and labels written by the operator or the console that must not be copied. */
const NON_COPYABLE_ANNOTATIONS = [
  Annotations.recoverByBiosUUID,
  Annotations.recoveredByBiosUUID,
  Annotations.allowDiskDeletion,
  Annotations.allowBootDiskDeletion,
  Annotations.restartPending,
  Annotations.paused,
  Annotations.sourceTemplate,
  Annotations.sourceTemplateVersion,
  Annotations.clonedFrom,
  Annotations.createdBy,
  Annotations.updatedBy,
  "kubectl.kubernetes.io/last-applied-configuration",
];

/**
 * Produces a fresh, creatable VirtualMachine from an existing one: identity,
 * status and controller-owned fields are removed.
 */
export function cleanVMForCopy(vm: VirtualMachine): VirtualMachine {
  const spec = structuredClone(vm.spec);
  delete spec.biosUUID;
  const annotations = Object.fromEntries(
    Object.entries(vm.metadata.annotations ?? {}).filter(([k]) => !NON_COPYABLE_ANNOTATIONS.includes(k as never) && !k.startsWith(Annotations.requestIdPrefix)),
  );
  const labels = { ...(vm.metadata.labels ?? {}) };
  delete labels[Labels.template];
  return {
    apiVersion: "vmm.v4.nutanix.com/v1alpha1",
    kind: "VirtualMachine",
    metadata: {
      namespace: vm.metadata.namespace,
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(Object.keys(annotations).length ? { annotations } : {}),
    },
    spec,
  };
}

/** Strips server-managed metadata so an object is compact for transport and display. */
export function stripManagedFields<T extends { metadata: { managedFields?: unknown; annotations?: Record<string, string> } }>(obj: T): T {
  if (!obj?.metadata) return obj;
  const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
  const hasLastApplied = obj.metadata.annotations && LAST_APPLIED in obj.metadata.annotations;
  if (!obj.metadata.managedFields && !hasLastApplied) return obj;
  const { managedFields: _ignored, ...metadata } = obj.metadata;
  if (hasLastApplied) {
    const { [LAST_APPLIED]: _la, ...annotations } = obj.metadata.annotations as Record<string, string>;
    metadata.annotations = annotations;
  }
  return { ...obj, metadata } as T;
}
