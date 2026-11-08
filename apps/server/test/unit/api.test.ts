import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/app";
import { AccessService } from "../../src/auth/access";
import { ipInCidrs, parseGroups } from "../../src/auth/identity";
import { loadConfig } from "../../src/config";
import type { Deps } from "../../src/context";
import { fieldToPointer } from "../../src/errors";
import { setLogLevel } from "../../src/log";
import { PrismService } from "../../src/prism/service";
import { ContextService } from "../../src/services/contexts";
import { GuestScriptService } from "../../src/services/guest-scripts";
import { TemplateService } from "../../src/services/templates";
import { VMService } from "../../src/services/vms";
import { VMServiceService } from "../../src/services/vmservices";
import type { StreamHub } from "../../src/stream/hub";
import { FakeKube } from "./fake-kube";

setLogLevel("error");

const ORIGIN = "http://localhost";
const ALICE = { "x-forwarded-user": "alice", "x-forwarded-groups": "team-a-admins,devs" };

function vm(name: string, ns = "team-a") {
  return {
    apiVersion: "vmm.v4.nutanix.com/v1alpha1",
    kind: "VirtualMachine",
    metadata: { name, namespace: ns, labels: { app: "web" } },
    spec: {
      placement: { cluster: { type: "name", name: "PE-01" } },
      compute: { numSockets: 2, memorySize: "4Gi" },
      bootConfiguration: { bootDisk: { source: { type: "Image", image: { type: "name", name: "ubuntu" } } } },
      network: { nics: [{ name: "nic0", networkInfo: { subnet: { type: "name", name: "vlan" } } }] },
      powerState: "On",
    },
    status: { externalID: "x", powerState: "On" },
  };
}

function setup(env: Record<string, string> = {}) {
  const kube = new FakeKube();
  const cfg = loadConfig({ AUTH_MODE: "traefik", ...env });
  // AccessService stub: alice may do everything in team-a only.
  const access = new AccessService(kube, 0, []);
  access.namespaces = async (id) =>
    id?.user === "alice"
      ? [
          {
            name: "team-a",
            permissions: {
              virtualmachines: { list: true, create: true, patch: true, update: true, delete: true, get: true },
              configmaps: { list: true, create: true, update: true, delete: true },
              secrets: { list: true, get: true, create: true, update: true, delete: true },
            },
          },
        ]
      : [];
  access.clusterWide = async () => false;
  kube.authorize = (c) => c.identity === undefined || (c.identity.user === "alice" && c.namespace === "team-a");
  const vms = new VMService();
  const templates = new TemplateService();
  const deps: Deps = {
    cfg,
    sa: kube,
    access,
    prism: new PrismService(kube, cfg),
    vms,
    templates,
    contexts: new ContextService(),
    guestScripts: new GuestScriptService(templates),
    vmServices: new VMServiceService(),
    hub: { subscribe: () => () => {}, stopAll() {} } as unknown as StreamHub,
    readiness: async () => ({ ok: true }),
  };
  return { kube, app: createApp(deps), deps };
}

const json = (body: unknown, headers: Record<string, string> = ALICE) => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify(body),
});

describe("identity", () => {
  test("parses groups and drops reserved system: groups", () => {
    expect(parseGroups("a, b,system:masters,,c", ",")).toEqual(["a", "b", "c"]);
  });
  // NKP's traefik-forward-auth sends one Impersonate-Group header per group; Bun < 1.4 kept only the last one.
  test("merges repeated group headers received by Bun.serve", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => Response.json(parseGroups(req.headers.get("impersonate-group") ?? undefined, ",")),
    });
    try {
      let raw = "";
      const done = Promise.withResolvers<void>();
      const sock = await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port as number,
        socket: {
          data: (_s, d) => {
            raw += d.toString();
          },
          close: () => done.resolve(),
        },
      });
      sock.write(
        "GET / HTTP/1.1\r\nHost: x\r\nImpersonate-Group: system:authenticated\r\nImpersonate-Group: oidc:a\r\nImpersonate-Group: oidc:b\r\nConnection: close\r\n\r\n",
      );
      await done.promise;
      expect(JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4))).toEqual(["oidc:a", "oidc:b"]);
    } finally {
      server.stop(true);
    }
  });
  test("matches CIDRs (IPv4, IPv6, mapped)", () => {
    expect(ipInCidrs("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipInCidrs("::ffff:10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipInCidrs("192.168.1.1", ["10.0.0.0/8"])).toBe(false);
    expect(ipInCidrs("fd00::1", ["fd00::/8"])).toBe(true);
  });
  test("converts Kubernetes cause fields to JSON pointers", () => {
    expect(fieldToPointer("spec.storage.dataDisks[1].diskSize")).toBe("/spec/storage/dataDisks/1/diskSize");
  });
  test("refuses dev auth inside a cluster", () => {
    process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
    expect(() => loadConfig({ AUTH_MODE: "dev", KUBERNETES_SERVICE_HOST: "10.0.0.1" })).toThrow(/refused/);
    delete process.env.KUBERNETES_SERVICE_HOST;
  });
});

describe("API", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.kube.seed("virtualmachines", vm("web-01"));
    ctx.kube.seed("virtualmachines", vm("other", "team-b"));
  });

  test("health endpoints are public", async () => {
    expect((await ctx.app.request("/healthz")).status).toBe(200);
    expect((await ctx.app.request("/readyz")).status).toBe(200);
  });

  test("rejects requests without an authenticated user", async () => {
    const res = await ctx.app.request("/api/me");
    expect(res.status).toBe(401);
  });

  test("every Kubernetes call is impersonated", async () => {
    const res = await ctx.app.request("/api/vms", { headers: ALICE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { metadata: { name: string } }[] };
    expect(body.items.map((v) => v.metadata.name)).toEqual(["web-01"]);
    const userCalls = ctx.kube.calls.filter((c) => c.plural === "virtualmachines");
    expect(userCalls.length).toBeGreaterThan(0);
    for (const c of userCalls) expect(c.identity).toEqual({ user: "alice", groups: ["team-a-admins", "devs"] });
  });

  test("forbidden namespaces return the API server 403", async () => {
    const res = await ctx.app.request("/api/namespaces/team-b/vms/other", { headers: ALICE });
    expect(res.status).toBe(403);
  });

  test("power actions patch the desired state", async () => {
    const res = await ctx.app.request("/api/namespaces/team-a/vms/web-01/actions/stop", json({}));
    expect(res.status).toBe(200);
    expect((ctx.kube.store.get("virtualmachines/team-a/web-01") as unknown as { spec: { powerState: string } }).spec.powerState).toBe("Off");
  });

  test("restart powers off with a pending marker, then continueRestart powers on", async () => {
    await ctx.app.request("/api/namespaces/team-a/vms/web-01/actions/restart", json({}));
    const stored = ctx.kube.store.get("virtualmachines/team-a/web-01") as unknown as ReturnType<typeof vm> & {
      metadata: { annotations?: Record<string, string> };
    };
    expect(stored.spec.powerState).toBe("Off");
    expect(stored.metadata.annotations?.["console.nutanix.com/restart-pending"]).toBeDefined();
    stored.status.powerState = "Off";
    const done = await ctx.deps.vms.continueRestart(ctx.kube.as({ user: "alice", groups: [] }), stored as never);
    expect(done).toBe(true);
    const after = ctx.kube.store.get("virtualmachines/team-a/web-01") as unknown as typeof stored;
    expect(after.spec.powerState).toBe("On");
    expect(after.metadata.annotations?.["console.nutanix.com/restart-pending"]).toBeUndefined();
  });

  test("CSRF: cross-origin mutation is rejected", async () => {
    const res = await ctx.app.request("/api/namespaces/team-a/vms/web-01/actions/stop", {
      method: "POST",
      headers: { ...ALICE, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(403);
  });

  test("invalid VM is rejected with field-level details", async () => {
    const bad = vm("bad");
    bad.spec.compute.memorySize = "lots";
    const res = await ctx.app.request("/api/namespaces/team-a/vms", json(bad));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { path: string }[] } };
    expect(body.error.details.map((d) => d.path)).toContain("/spec/compute/memorySize");
  });

  test("template lifecycle: create, list with usage, instantiate, delete", async () => {
    const tpl = {
      name: "ubuntu",
      displayName: "Ubuntu",
      tags: ["linux"],
      vm: { spec: { ...vm("x").spec, placement: { cluster: { type: "name", name: "" } } } },
      parameters: [{ name: "cluster", path: "/spec/placement/cluster", type: "clusterRef", required: true }],
    };
    let res = await ctx.app.request("/api/namespaces/team-a/templates", json(tpl));
    expect(res.status).toBe(201);
    const cm = ctx.kube.store.get("configmaps/team-a/vmt-ubuntu") as unknown as {
      metadata: { labels: Record<string, string>; annotations: Record<string, string> };
    };
    expect(cm.metadata.labels["console.nutanix.com/type"]).toBe("vm-template");
    expect(cm.metadata.annotations["console.nutanix.com/created-by"]).toBe("alice");
    // the dry-run create of a rendered VM was issued as alice
    expect(ctx.kube.calls.some((c) => c.verb === "create" && c.plural === "virtualmachines" && c.dryRun && c.identity?.user === "alice")).toBe(true);

    res = await ctx.app.request("/api/namespaces/team-a/templates/ubuntu/instantiate", json({ namePattern: "u-{1..3}", values: {} }));
    expect(res.status).toBe(422);
    res = await ctx.app.request(
      "/api/namespaces/team-a/templates/ubuntu/instantiate",
      json({ namePattern: "u-{1..3}", values: { cluster: { type: "name", name: "PE-02" } } }),
    );
    const result = (await res.json()) as { results: { ok: boolean }[] };
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(ctx.kube.store.has("virtualmachines/team-a/u-3")).toBe(true);

    res = await ctx.app.request("/api/namespaces/team-a/templates", { headers: ALICE });
    const list = (await res.json()) as { items: { name: string; usageCount: number }[] };
    expect(list.items.find((t) => t.name === "ubuntu")?.usageCount).toBe(3);

    res = await ctx.app.request("/api/namespaces/team-a/templates/ubuntu", { method: "DELETE", headers: { ...ALICE, origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(ctx.kube.store.has("configmaps/team-a/vmt-ubuntu")).toBe(false);
  });

  test("edits are rejected when the spec changed concurrently", async () => {
    const res0 = await ctx.app.request("/api/namespaces/team-a/vms/web-01", { headers: ALICE });
    const current = (await res0.json()) as ReturnType<typeof vm> & { metadata: { generation: number } };
    const stored = ctx.kube.store.get("virtualmachines/team-a/web-01") as unknown as typeof current;
    stored.metadata.generation = 5;
    current.spec.compute.memorySize = "8Gi";
    const res = await ctx.app.request("/api/namespaces/team-a/vms/web-01", { ...json(current), method: "PUT" });
    expect(res.status).toBe(409);
  });

  test("guest scripts: create, list with usage, edit, conflicts and delete", async () => {
    const base = "/api/namespaces/team-a/guest-secrets";
    const cloudConfig = "#cloud-config\nusers:\n  - name: ops\n";
    let res = await ctx.app.request(base, json({ name: "ubuntu-base", type: "CloudInit", content: cloudConfig, description: "Ops user" }));
    expect(res.status).toBe(201);
    const stored = ctx.kube.store.get("secrets/team-a/ubuntu-base") as unknown as {
      data: Record<string, string>;
      metadata: { labels: Record<string, string> };
    };
    expect(Buffer.from(stored.data.userData as string, "base64").toString()).toBe(cloudConfig);
    expect(stored.metadata.labels["console.nutanix.com/type"]).toBe("guest-customization");

    // A name already taken is refused instead of silently overwriting the script.
    res = await ctx.app.request(base, json({ name: "ubuntu-base", type: "CloudInit", content: cloudConfig }));
    expect(res.status).toBe(409);
    // Broken cloud-config YAML is rejected before it reaches a VM.
    res = await ctx.app.request(base, json({ name: "broken", type: "CloudInit", content: "#cloud-config\nusers: [ops\n" }));
    expect(res.status).toBe(422);

    const web = vm("web-02");
    (web.spec as Record<string, unknown>).guestCustomization = { type: "CloudInit", secretRef: { name: "ubuntu-base" } };
    ctx.kube.seed("virtualmachines", web);
    res = await ctx.app.request(base, { headers: ALICE });
    const list = (await res.json()) as { items: { name: string; type: string; description?: string; usage: { vms: number } }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: "ubuntu-base", type: "CloudInit", description: "Ops user", usage: { vms: 1 } });

    res = await ctx.app.request(`${base}/ubuntu-base`, { headers: ALICE });
    const script = (await res.json()) as { content: string; resourceVersion: string; usage: { vms: { name: string; provisioned: boolean }[] } };
    expect(script.content).toBe(cloudConfig);
    expect(script.usage.vms).toEqual([{ name: "web-02", provisioned: true }]);

    const edit = { type: "CloudInit", content: `${cloudConfig}package_update: true\n`, resourceVersion: script.resourceVersion };
    res = await ctx.app.request(`${base}/ubuntu-base`, { ...json(edit), method: "PUT" });
    expect(res.status).toBe(200);
    // Saving again from the old version is a conflict, not a silent overwrite.
    res = await ctx.app.request(`${base}/ubuntu-base`, { ...json(edit), method: "PUT" });
    expect(res.status).toBe(409);
    // VMs reference the script with its engine: the type cannot change.
    res = await ctx.app.request(`${base}/ubuntu-base`, { ...json({ type: "Sysprep", content: "<unattend/>" }), method: "PUT" });
    expect(res.status).toBe(422);

    // Secrets not created for guest customization are not exposed or deleted here.
    ctx.kube.seed("secrets", { metadata: { name: "pc-credentials", namespace: "team-a" }, data: { password: "eA==" } });
    res = await ctx.app.request(`${base}/pc-credentials`, { headers: ALICE });
    expect(res.status).toBe(404);
    res = await ctx.app.request(`${base}/pc-credentials`, { method: "DELETE", headers: { ...ALICE, origin: ORIGIN } });
    expect(res.status).toBe(404);
    expect(ctx.kube.store.has("secrets/team-a/pc-credentials")).toBe(true);

    res = await ctx.app.request(`${base}/ubuntu-base`, { method: "DELETE", headers: { ...ALICE, origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(ctx.kube.store.has("secrets/team-a/ubuntu-base")).toBe(false);
  });

  test("unknown API routes return JSON 404", async () => {
    const res = await ctx.app.request("/api/nope", { headers: ALICE });
    expect(res.status).toBe(404);
  });
});

describe("base path", () => {
  test("routes are mounted under BASE_PATH", async () => {
    const { app } = setup({ BASE_PATH: "/dkp/vm-console" });
    expect((await app.request("/dkp/vm-console/healthz")).status).toBe(200);
    expect((await app.request("/healthz")).status).toBe(404);
  });
});
