import type { VirtualMachine } from "../src";

export function sampleVM(overrides: Partial<VirtualMachine["spec"]> = {}): VirtualMachine {
  return {
    apiVersion: "vmm.v4.nutanix.com/v1alpha1",
    kind: "VirtualMachine",
    metadata: { name: "web-01", namespace: "team-a", labels: { tier: "web" } },
    spec: {
      placement: { cluster: { type: "name", name: "PE-01" } },
      compute: { numSockets: 2, numCoresPerSocket: 1, memorySize: "4Gi" },
      bootConfiguration: {
        bootType: "uefi",
        bootDisk: {
          source: { type: "Image", image: { type: "name", name: "ubuntu-24.04" } },
          diskSize: "40Gi",
          deviceProperties: { adapterType: "SCSI", deviceIndex: 0 },
        },
      },
      network: { nics: [{ name: "nic0", networkInfo: { subnet: { type: "name", name: "vlan-100" } } }] },
      powerState: "On",
      ...overrides,
    },
  };
}
