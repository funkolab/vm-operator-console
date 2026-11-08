import { describe, expect, test } from "bun:test";
import { summarizeChanges, type VirtualMachine, validateVirtualMachine, validateVirtualMachineService } from "../src";
import { sampleVM } from "./fixtures";

const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe("validateVirtualMachine", () => {
  test("accepts a valid VM", () => {
    expect(validateVirtualMachine(sampleVM(), { mode: "create" })).toEqual([]);
  });

  test("requires compute, boot disk and network", () => {
    const vm = sampleVM({ compute: undefined, bootConfiguration: undefined, network: undefined });
    const p = paths(validateVirtualMachine(vm, { mode: "create" }));
    expect(p).toContain("/spec/compute/numSockets");
    expect(p).toContain("/spec/compute/memorySize");
    expect(p).toContain("/spec/bootConfiguration");
    expect(p).toContain("/spec/bootConfiguration/bootDisk");
    expect(p).toContain("/spec/network");
  });

  test("rejects SCSI.0 data disk and duplicate addresses", () => {
    const vm = sampleVM({
      storage: {
        dataDisks: [
          { diskSize: "10Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: 0 } },
          { diskSize: "10Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: 1 } },
          { diskSize: "10Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: 1 } },
        ],
      },
    });
    const issues = validateVirtualMachine(vm, { mode: "create" });
    expect(issues.find((i) => i.path === "/spec/storage/dataDisks/0/deviceProperties")?.message).toMatch(/reserved/);
    expect(issues.find((i) => i.path === "/spec/storage/dataDisks/2/deviceProperties")?.message).toMatch(/already used/);
  });

  test("requires flashMode for Flash disks", () => {
    const vm = sampleVM({
      storage: { dataDisks: [{ diskSize: "10Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: 1 }, storageConfig: { diskMode: "Flash" } }] },
    });
    expect(paths(validateVirtualMachine(vm, { mode: "create" }))).toContain("/spec/storage/dataDisks/0/storageConfig/diskMode");
    vm.spec.storage = { ...vm.spec.storage, flashMode: true };
    expect(validateVirtualMachine(vm, { mode: "create" })).toEqual([]);
  });

  test("guest customization is exclusive", () => {
    const vm = sampleVM({ guestCustomization: { type: "CloudInit" } });
    expect(paths(validateVirtualMachine(vm, { mode: "create" }))).toContain("/spec/guestCustomization");
  });

  test("template mode rejects biosUUID and does not require a name", () => {
    const vm = sampleVM({ biosUUID: "6f1c0c0e-1b2a-4c9b-8a6e-0d0f6a7b8c9d" });
    vm.metadata = {};
    expect(paths(validateVirtualMachine(vm, { mode: "template" }))).toEqual(["/spec/biosUUID"]);
  });
});

describe("transition rules", () => {
  const provisioned = (vm: VirtualMachine): VirtualMachine => ({
    ...vm,
    status: { externalID: "abc", powerState: "On" },
  });

  test("memory decrease requires power off", () => {
    const old = provisioned(sampleVM());
    const next = structuredClone(old);
    next.spec.compute = { ...next.spec.compute, memorySize: "2Gi" };
    expect(paths(validateVirtualMachine(next, { mode: "update", old }))).toContain("/spec/compute/memorySize");
    next.spec.powerState = "Off";
    expect(validateVirtualMachine(next, { mode: "update", old })).toEqual([]);
  });

  test("cluster is immutable and disk removal needs annotation", () => {
    const old = provisioned(sampleVM({ storage: { dataDisks: [{ diskSize: "10Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: 1 } }] } }));
    const next = structuredClone(old);
    next.spec.placement = { cluster: { type: "name", name: "PE-02" } };
    next.spec.storage = { dataDisks: [] };
    const p = paths(validateVirtualMachine(next, { mode: "update", old }));
    expect(p).toContain("/spec/placement/cluster");
    expect(p).toContain("/spec/storage/dataDisks");
  });

  test("summarizeChanges flags cold changes", () => {
    const old = provisioned(sampleVM());
    const next = structuredClone(old);
    next.spec.compute = { ...next.spec.compute, numCoresPerSocket: 2 };
    const s = summarizeChanges(old, next);
    expect(s.changed).toBe(true);
    expect(s.requiresPowerOff).toEqual(["Change cores per socket"]);
  });
});

describe("validateVirtualMachineService", () => {
  test("multi-port services need port names; headless needs ClusterIP", () => {
    const issues = validateVirtualMachineService({
      metadata: { name: "web" },
      spec: { selector: { matchLabels: { a: "b" } }, type: "LoadBalancer", headless: true, ports: [{ port: 80 }, { port: 443 }] },
    });
    expect(paths(issues)).toEqual(["/spec/ports/0/name", "/spec/ports/1/name", "/spec/headless"]);
  });
});
