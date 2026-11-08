import { describe, expect, test } from "bun:test";
import {
  Annotations,
  expandNamePattern,
  instantiateTemplate,
  Labels,
  parseQuantity,
  summarizeVM,
  templateFromConfigMap,
  templateFromVM,
  templateToConfigMap,
  type VMTemplate,
  VMTemplateSchema,
  validateParameterValues,
  validateVirtualMachine,
} from "../src";
import { sampleVM } from "./fixtures";

function sampleTemplate(): VMTemplate {
  const vm = sampleVM();
  return VMTemplateSchema.parse({
    name: "ubuntu-medium",
    namespace: "team-a",
    displayName: "Ubuntu Medium",
    tags: ["ubuntu"],
    vm: { metadata: { labels: { tier: "web" } }, spec: vm.spec },
    parameters: [
      { name: "cluster", path: "/spec/placement/cluster", type: "clusterRef", required: true },
      { name: "memory", path: "/spec/compute/memorySize", type: "quantity", default: "4Gi", min: "1Gi", max: "64Gi" },
      { name: "sockets", path: "/spec/compute/numSockets", type: "integer", default: 2, min: 1, max: 8 },
    ],
  });
}

describe("templates", () => {
  test("round-trips through a ConfigMap", () => {
    const t = sampleTemplate();
    const cm = templateToConfigMap(t, { user: "alice" });
    expect(cm.metadata.name).toBe("vmt-ubuntu-medium");
    expect(cm.metadata.labels?.[Labels.type]).toBe("vm-template");
    expect(cm.metadata.annotations?.[Annotations.createdBy]).toBe("alice");
    const back = templateFromConfigMap({ ...cm, metadata: { ...cm.metadata, resourceVersion: "7" } });
    expect(back.name).toBe("ubuntu-medium");
    expect(back.vm.spec).toEqual(t.vm.spec);
    expect(back.parameters).toEqual(t.parameters);
    expect(back.tags).toEqual(["ubuntu"]);
  });

  test("instantiates with parameter values and traceability", () => {
    const t = { ...sampleTemplate(), resourceVersion: "42" };
    const vm = instantiateTemplate(t, {
      name: "web-07",
      namespace: "team-a",
      values: { cluster: { type: "name", name: "PE-09" }, memory: "8Gi", sockets: "4" },
    });
    expect(vm.metadata.name).toBe("web-07");
    expect(vm.spec.placement.cluster).toEqual({ type: "name", name: "PE-09" });
    expect(vm.spec.compute?.memorySize).toBe("8Gi");
    expect(vm.spec.compute?.numSockets).toBe(4);
    expect(vm.metadata.labels?.[Labels.template]).toBe("ubuntu-medium");
    expect(vm.metadata.annotations?.[Annotations.sourceTemplate]).toBe("team-a/vmt-ubuntu-medium");
    expect(vm.metadata.annotations?.[Annotations.sourceTemplateVersion]).toBe("42");
    expect(validateVirtualMachine(vm, { mode: "create" })).toEqual([]);
  });

  test("validates parameter values", () => {
    const t = sampleTemplate();
    const errs = validateParameterValues(t, { memory: "128Gi", sockets: 0 });
    expect(errs.map((e) => e.parameter).sort()).toEqual(["cluster", "memory", "sockets"]);
  });

  test("rejects invalid parameters", () => {
    const r = VMTemplateSchema.safeParse({
      ...sampleTemplate(),
      parameters: [
        { name: "a", path: "/metadata/name", type: "string" },
        { name: "a", path: "/spec/x", type: "enum" },
      ],
    });
    expect(r.success).toBe(false);
  });

  test("builds a template from a VM, dropping identity", () => {
    const vm = sampleVM({ biosUUID: "6f1c0c0e-1b2a-4c9b-8a6e-0d0f6a7b8c9d", displayName: "Web 01" });
    vm.metadata.annotations = { [Annotations.recoveredByBiosUUID]: "true", "vmm.v4.nutanix.com/request-id-create": "x", keep: "me" };
    const t = templateFromVM(vm, { name: "from-vm", namespace: "team-a", displayName: "From VM" });
    expect(t.vm.spec.biosUUID).toBeUndefined();
    expect(t.vm.spec.displayName).toBeUndefined();
    expect(t.vm.metadata.annotations).toEqual({ keep: "me" });
  });

  test("expands name patterns", () => {
    expect(expandNamePattern("web-{01..03}")).toEqual(["web-01", "web-02", "web-03"]);
    expect(expandNamePattern("db", 2)).toEqual(["db-01", "db-02"]);
    expect(expandNamePattern("app-{#}-x", 2, 9)).toEqual(["app-09-x", "app-10-x"]);
    expect(expandNamePattern("single")).toEqual(["single"]);
  });
});

describe("vm helpers", () => {
  test("quantities", () => {
    expect(parseQuantity("4Gi")).toBe(4 * 2 ** 30);
    expect(parseQuantity("1.5G")).toBe(1.5e9);
    expect(Number.isNaN(parseQuantity("4GB"))).toBe(true);
  });

  test("summary derives phase and capacity", () => {
    const vm = sampleVM();
    vm.status = {
      externalID: "x",
      powerState: "On",
      addresses: [{ type: "InternalIP", address: "10.0.0.5", source: "Learned" }],
      conditions: [{ type: "Ready", status: "True", reason: "Ready", message: "", lastTransitionTime: "2026-01-01T00:00:00Z" }],
    };
    const s = summarizeVM(vm);
    expect(s.phase).toBe("Running");
    expect(s.vcpus).toBe(2);
    expect(s.primaryIP).toBe("10.0.0.5");
    expect(s.diskBytes).toBe(40 * 2 ** 30);
    vm.spec.powerState = "Off";
    expect(summarizeVM(vm).phase).toBe("Stopping");
  });
});
