/**
 * Simulates vm-operator status for the seeded objects (there is no Prism
 * Central in the dev cluster). Patches the /status subresource so the UI can
 * be exercised with realistic states: running, stopped, provisioning, error,
 * drift and connected contexts.
 *
 * Usage: bun hack/kind/fake-status.ts [--context kind-vm-console-dev] [--follow]
 *   --follow keeps reconciling power state changes like a (fake) controller.
 */
import { execFileSync, spawn } from "node:child_process";

const args = process.argv.slice(2);
const ctxIdx = args.indexOf("--context");
const kubeContext = ctxIdx >= 0 ? args[ctxIdx + 1] : (process.env.KUBE_CONTEXT ?? "kind-vm-console-dev");
const follow = args.includes("--follow");

const kubectl = (...a: string[]) => execFileSync("kubectl", ["--context", kubeContext as string, ...a], { encoding: "utf8" });
const now = () => new Date().toISOString();

function cond(type: string, status: "True" | "False" | "Unknown", reason: string, message = "", gen = 1) {
  return { type, status, reason, message, lastTransitionTime: now(), observedGeneration: gen };
}

function patchStatus(kind: string, ns: string, name: string, status: unknown) {
  try {
    kubectl("patch", kind, name, "-n", ns, "--subresource=status", "--type=merge", "-p", JSON.stringify({ status }));
    console.log(`patched ${kind} ${ns}/${name}`);
  } catch (e) {
    console.error(`failed to patch ${kind} ${ns}/${name}: ${(e as Error).message}`);
  }
}

function uuid() {
  return crypto.randomUUID();
}

interface VM {
  metadata: { name: string; namespace: string; generation: number; labels?: Record<string, string>; annotations?: Record<string, string> };
  spec: {
    powerState?: "On" | "Off";
    network?: { nics?: { name: string }[] };
    storage?: { dataDisks?: { diskSize?: string; deviceProperties?: { adapterType: string; deviceIndex: number } }[] };
    context?: { name: string };
  };
  status?: { externalID?: string; powerState?: string; nics?: { name: string; extID: string; macAddress?: string }[]; disks?: unknown[] };
}

const ipFor = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 200;
  return `10.20.${(h % 50) + 1}.${(h % 200) + 20}`;
};

const toBytes = (q?: string) => {
  const m = /^(\d+)(Gi|Mi|Ti)?$/.exec(q ?? "");
  if (!m) return 0;
  const mult = { Gi: 2 ** 30, Mi: 2 ** 20, Ti: 2 ** 40 }[m[2] as "Gi"] ?? 1;
  return Number(m[1]) * mult;
};

const SPECIAL: Record<string, "provisioning" | "error" | "drift"> = {
  "team-a/build-agent": "error",
  "team-a/db-01": "drift",
};

function vmStatus(vm: VM) {
  const key = `${vm.metadata.namespace}/${vm.metadata.name}`;
  const gen = vm.metadata.generation;
  const special = SPECIAL[key];
  const desired = vm.spec.powerState ?? "On";
  const ctxName = vm.spec.context?.name ?? (vm.metadata.namespace === "team-b" ? "pc-lab" : "pc-prod");
  if (special === "error")
    return {
      observedGeneration: gen,
      resolvedContextRef: { name: ctxName },
      conditions: [
        cond("Ready", "False", "ResourceNotFound", 'subnet "vlan-100-prod" not found in project', gen),
        cond("ContextBound", "True", "ContextResolved", "", gen),
        cond("ResourcesResolved", "False", "ResourceNotFound", 'subnet "vlan-100-prod" not found in project', gen),
        cond("Provisioned", "False", "WaitingForResources", "Waiting for references to resolve", gen),
      ],
    };
  const externalID = vm.status?.externalID ?? uuid();
  const on = desired === "On";
  const nics = (vm.spec.network?.nics ?? []).map((n, i) => ({
    name: n.name,
    extID: vm.status?.nics?.find((x) => x.name === n.name)?.extID ?? uuid(),
    macAddress: `50:6b:8d:${(i + 16).toString(16)}:${(externalID.charCodeAt(0) % 255).toString(16).padStart(2, "0")}:${(externalID.charCodeAt(1) % 255).toString(16).padStart(2, "0")}`,
  }));
  const disks = (vm.spec.storage?.dataDisks ?? []).map((d) => ({
    extID: uuid(),
    deviceProperties: d.deviceProperties ?? { adapterType: "SCSI", deviceIndex: 1 },
    sizeBytes: toBytes(d.diskSize),
  }));
  const ip = ipFor(key);
  const drift = special === "drift" ? [{ path: "spec.compute.memorySize", desired: "32Gi", observed: "24Gi" }] : undefined;
  return {
    observedGeneration: gen,
    appliedGeneration: gen,
    externalID,
    powerState: desired,
    resolvedContextRef: { name: ctxName },
    addresses: on
      ? [
          { type: "InternalIP", address: ip, source: "Assigned" },
          { type: "InternalIP", address: ip, source: "Learned" },
          { type: "Hostname", address: vm.metadata.name, source: "Learned" },
        ]
      : [{ type: "InternalIP", address: ip, source: "Assigned" }],
    nics,
    disks,
    drift: drift ?? null,
    conditions: [
      cond("Ready", "True", "Ready", "", gen),
      cond("ContextBound", "True", "ContextResolved", "", gen),
      cond("ResourcesResolved", "True", "ResourcesResolved", "", gen),
      cond("Provisioned", "True", "Provisioned", "", gen),
      cond("Synchronized", "True", "Synchronized", "", gen),
      cond("Drifted", drift ? "True" : "False", drift ? "DriftDetected" : "NoDrift", drift ? "1 field differs from the desired state" : "", gen),
      cond("PowerStateReconciled", "True", desired === "On" ? "PoweredOn" : "PoweredOff", "", gen),
      cond("AddressReady", on ? "True" : "False", on ? "AddressAssigned" : "PoweredOff", "", gen),
    ],
  };
}

function reconcileAll() {
  const vms = JSON.parse(kubectl("get", "virtualmachines", "-A", "-o", "json")).items as VM[];
  for (const vm of vms) {
    if (vm.metadata.annotations?.["infra.nutanix.com/paused"] !== undefined) continue;
    patchStatus("virtualmachines", vm.metadata.namespace, vm.metadata.name, vmStatus(vm));
  }
  const ctxs = JSON.parse(kubectl("get", "nutanixprismcontexts", "-A", "-o", "json")).items as VM[];
  for (const c of ctxs) {
    const lab = c.metadata.name === "pc-lab";
    patchStatus("nutanixprismcontexts", c.metadata.namespace, c.metadata.name, {
      observedGeneration: c.metadata.generation,
      pcVersion: lab ? undefined : "pc.7.6.0.1",
      project: lab ? undefined : { extId: "8f2c6a1e-3f0b-4d7a-9b5e-1c2d3e4f5a6b", name: "_internal", isDefault: true },
      conditions: lab
        ? [
            cond("Connected", "False", "ConnectionFailed", "dial tcp 10.10.0.20:9440: i/o timeout", c.metadata.generation),
            cond("Ready", "False", "ConnectionFailed", "dial tcp 10.10.0.20:9440: i/o timeout", c.metadata.generation),
          ]
        : [cond("Connected", "True", "ConnectionEstablished", "", c.metadata.generation), cond("Ready", "True", "Ready", "", c.metadata.generation)],
    });
  }
  const svcs = JSON.parse(kubectl("get", "virtualmachineservices", "-A", "-o", "json")).items as (VM & {
    spec: { selector: { matchLabels?: Record<string, string> } };
  })[];
  for (const s of svcs) {
    const sel = s.spec.selector.matchLabels ?? {};
    const members = vms.filter((v) => v.metadata.namespace === s.metadata.namespace && Object.entries(sel).every(([k, val]) => v.metadata.labels?.[k] === val));
    const ready = members.filter((v) => (v.spec.powerState ?? "On") === "On" && !SPECIAL[`${v.metadata.namespace}/${v.metadata.name}`]).length;
    patchStatus("virtualmachineservices", s.metadata.namespace, s.metadata.name, {
      observedGeneration: s.metadata.generation,
      serviceRef: { name: s.metadata.name },
      selectedVms: members.length,
      readyEndpoints: ready,
      lastEndpointSyncTime: now(),
      conditions: [
        cond("Ready", ready > 0 ? "True" : "False", ready > 0 ? "EndpointsReady" : "NoReadyEndpoints", "", s.metadata.generation),
        cond("EndpointsResolved", "True", "EndpointsResolved", `${ready}/${members.length} endpoints ready`, s.metadata.generation),
      ],
    });
  }
}

reconcileAll();

if (follow) {
  console.log("Following VirtualMachine changes (Ctrl+C to stop)…");
  const proc = spawn("kubectl", ["--context", kubeContext as string, "get", "virtualmachines", "-A", "--watch", "--output-watch-events", "-o", "json"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let buf = "";
  const seenGen = new Map<string, number>();
  proc.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let depth = 0;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === "{") depth++;
      else if (buf[i] === "}") {
        depth--;
        if (depth === 0) {
          const chunk = buf.slice(start, i + 1);
          start = i + 1;
          try {
            const ev = JSON.parse(chunk) as { type: string; object: VM };
            const vm = ev.object;
            const k = `${vm.metadata.namespace}/${vm.metadata.name}`;
            if (ev.type === "DELETED") {
              seenGen.delete(k);
              continue;
            }
            if (vm.metadata.annotations?.["infra.nutanix.com/paused"] !== undefined) continue;
            if (seenGen.get(k) === vm.metadata.generation && vm.status?.externalID) continue;
            seenGen.set(k, vm.metadata.generation);
            const delay = vm.status?.externalID ? 1500 : 4000;
            setTimeout(() => patchStatus("virtualmachines", vm.metadata.namespace, vm.metadata.name, vmStatus(vm)), delay);
          } catch {
            /* partial */
          }
        }
      }
    }
    buf = buf.slice(start);
  });
}
