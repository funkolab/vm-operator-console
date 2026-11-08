import {
  ApiVersions,
  type EndpointSlice,
  type KubeService,
  matchesSelector,
  stripManagedFields,
  type VirtualMachine,
  type VirtualMachineService,
  validateVirtualMachineService,
  vmIPs,
} from "@console/shared";
import { validationError } from "../errors";
import { type KubeClient, R } from "../k8s/client";

export interface SelectorPreview {
  vms: { name: string; displayName: string; powerState?: string; ip?: string; eligible: boolean; reason?: string }[];
}

export function membershipGate(vm: VirtualMachine): { eligible: boolean; reason?: string } {
  if (vm.status?.powerState !== "On") return { eligible: false, reason: "Powered off" };
  const ipv4 = (vm.status?.addresses ?? []).find((a) => a.type === "InternalIP" && a.source !== "Secondary" && /^\d+\.\d+\.\d+\.\d+$/.test(a.address));
  if (!ipv4) return { eligible: false, reason: "No routable IPv4 address" };
  return { eligible: true };
}

/** VirtualMachineService operations (impersonated). */
export class VMServiceService {
  async list(k: KubeClient, ns?: string) {
    return (await k.listAll<VirtualMachineService>(R.virtualmachineservices, ns)).items.map(stripManagedFields);
  }

  async get(k: KubeClient, ns: string, name: string) {
    const svc = stripManagedFields(await k.get<VirtualMachineService>(R.virtualmachineservices, ns, name));
    const [service, slices] = await Promise.all([
      svc.status?.serviceRef?.name ? k.get<KubeService>(R.services, ns, svc.status.serviceRef.name).catch(() => undefined) : Promise.resolve(undefined),
      k
        .list<EndpointSlice>(R.endpointslices, ns, { labelSelector: `kubernetes.io/service-name=${svc.status?.serviceRef?.name ?? name}` })
        .then((r) => r.items)
        .catch(() => [] as EndpointSlice[]),
    ]);
    return { service: svc, coreService: service ? stripManagedFields(service) : undefined, endpointSlices: slices.map(stripManagedFields) };
  }

  async previewSelector(k: KubeClient, ns: string, selector: VirtualMachineService["spec"]["selector"]): Promise<SelectorPreview> {
    const vms = (await k.listAll<VirtualMachine>(R.virtualmachines, ns)).items;
    return {
      vms: vms
        .filter((vm) => matchesSelector(selector, vm.metadata.labels))
        .map((vm) => ({
          name: vm.metadata.name as string,
          displayName: vm.spec.displayName || (vm.metadata.name as string),
          powerState: vm.status?.powerState,
          ip: vmIPs(vm)[0],
          ...membershipGate(vm),
        })),
    };
  }

  private normalize(input: VirtualMachineService, ns: string): VirtualMachineService {
    const { status: _s, ...rest } = input;
    return { ...rest, apiVersion: ApiVersions.vmm, kind: "VirtualMachineService", metadata: { ...input.metadata, namespace: ns } };
  }

  async create(k: KubeClient, ns: string, input: VirtualMachineService, dryRun = false) {
    const svc = this.normalize(input, ns);
    const issues = validateVirtualMachineService(svc);
    if (issues.length) throw validationError(issues);
    return stripManagedFields(await k.create<VirtualMachineService>(R.virtualmachineservices, ns, svc, { dryRun }));
  }

  async update(k: KubeClient, ns: string, name: string, input: VirtualMachineService) {
    const current = await k.get<VirtualMachineService>(R.virtualmachineservices, ns, name);
    const next = {
      ...current,
      metadata: { ...current.metadata, labels: input.metadata.labels, resourceVersion: input.metadata.resourceVersion ?? current.metadata.resourceVersion },
      spec: input.spec,
    };
    const issues = validateVirtualMachineService(next);
    if (issues.length) throw validationError(issues);
    return stripManagedFields(await k.replace<VirtualMachineService>(R.virtualmachineservices, ns, name, next));
  }

  async delete(k: KubeClient, ns: string, name: string) {
    await k.delete(R.virtualmachineservices, ns, name);
  }
}
