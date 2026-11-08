import {
  Annotations,
  type DashboardStats,
  DNS1123_SUBDOMAIN,
  type KubeEvent,
  Labels,
  LabelValues,
  type MeResponse,
  NamespaceParam,
  type NutanixPrismContext,
  type Secret,
  type StreamMessage,
  stripManagedFields,
  summarizeVM,
  type VirtualMachine,
  type VirtualMachineService,
  type WatchKind,
} from "@console/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient, userName } from "../context";
import { ApiError } from "../errors";
import { R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { zv } from "./validate";

const WATCH_KINDS = ["virtualmachines", "virtualmachineservices", "nutanixprismcontexts", "configmaps", "events"] as const;

const GuestSecretSchema = z.object({
  name: z.string().regex(DNS1123_SUBDOMAIN).max(253),
  type: z.enum(["CloudInit", "Sysprep"]),
  content: z
    .string()
    .min(1)
    .max(64 * 1024),
});

export function systemRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/me", async (c) => {
      const id = c.get("identity");
      const [namespaces, clusterWide] = await Promise.all([deps.access.namespaces(id), deps.access.clusterWide(id).catch(() => false)]);
      const body: MeResponse = {
        user: id?.user ?? "(console identity)",
        groups: id?.groups ?? [],
        authMode: deps.cfg.AUTH_MODE,
        namespaces,
        clusterWide,
      };
      return c.json(body);
    })
    .post("/me/refresh", async (c) => {
      deps.access.invalidate(c.get("identity"));
      return c.json({ ok: true });
    })
    .get("/debug/identity", (c) => {
      if (!deps.cfg.AUTH_DEBUG) throw new ApiError(404, "NotFound", "Not found");
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((v, k) => {
        if (!/authorization|cookie/i.test(k)) headers[k] = v;
      });
      return c.json({ identity: c.get("identity") ?? null, headers });
    })
    .get("/namespaces/:ns/events", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      const res = await userClient(c, deps).list<KubeEvent>(R.events, ns, { limit: 500 });
      return c.json({ items: res.items.map(stripManagedFields) });
    })
    .get("/events", async (c) => {
      const k = userClient(c, deps);
      const nsList = (await deps.access.namespaces(c.get("identity"))).filter((n) => n.permissions.events?.list);
      const res = await Promise.all(
        nsList.map((n) =>
          k
            .list<KubeEvent>(R.events, n.name, { limit: 300 })
            .then((r) => r.items)
            .catch(() => [] as KubeEvent[]),
        ),
      );
      const relevant = new Set(["VirtualMachine", "VirtualMachineService", "NutanixPrismContext"]);
      return c.json({
        items: res
          .flat()
          .filter((e) => relevant.has(e.involvedObject.kind ?? ""))
          .map(stripManagedFields),
      });
    })
    .get("/stats", zv("query", z.object({ namespace: z.string().optional() })), async (c) => {
      const k = userClient(c, deps);
      const want = c.req.valid("query").namespace;
      const nsList = (await deps.access.namespaces(c.get("identity"))).filter((n) => !want || n.name === want);
      const pick = <T>(perm: (p: (typeof nsList)[number]) => boolean | undefined, fn: (ns: string) => Promise<T[]>) =>
        Promise.all(nsList.filter(perm).map((n) => fn(n.name).catch(() => [] as T[]))).then((r) => r.flat());
      const [vms, ctxs, svcs, tmpls] = await Promise.all([
        pick(
          (n) => n.permissions.virtualmachines?.list,
          (ns) => k.listAll<VirtualMachine>(R.virtualmachines, ns).then((r) => r.items),
        ),
        pick(
          (n) => n.permissions.nutanixprismcontexts?.list,
          (ns) => k.listAll<NutanixPrismContext>(R.nutanixprismcontexts, ns).then((r) => r.items),
        ),
        pick(
          (n) => n.permissions.virtualmachineservices?.list,
          (ns) => k.listAll<VirtualMachineService>(R.virtualmachineservices, ns).then((r) => r.items),
        ),
        pick(
          (n) => n.permissions.configmaps?.list,
          (ns) => k.listAll<{ metadata: object }>(R.configmaps, ns, { labelSelector: `${Labels.type}=${LabelValues.vmTemplate}` }).then((r) => r.items),
        ),
      ]);
      const sums = vms.map(summarizeVM);
      const byPhase: Record<string, number> = {};
      const byCluster = new Map<string, { cluster: string; count: number; vcpus: number; memoryBytes: number }>();
      const byNs = new Map<string, { namespace: string; count: number; on: number }>();
      const attention: DashboardStats["attention"] = [];
      for (const s of sums) {
        byPhase[s.phase] = (byPhase[s.phase] ?? 0) + 1;
        const cl = byCluster.get(s.cluster) ?? { cluster: s.cluster, count: 0, vcpus: 0, memoryBytes: 0 };
        cl.count++;
        cl.vcpus += s.vcpus;
        cl.memoryBytes += s.memoryBytes;
        byCluster.set(s.cluster, cl);
        const n = byNs.get(s.namespace) ?? { namespace: s.namespace, count: 0, on: 0 };
        n.count++;
        if (s.powerState === "On") n.on++;
        byNs.set(s.namespace, n);
        if (s.phase === "Error" || s.phase === "Degraded")
          attention.push({ kind: "VirtualMachine", namespace: s.namespace, name: s.name, reason: s.readyReason ?? s.phase, message: s.readyMessage });
        else if (s.driftCount)
          attention.push({ kind: "VirtualMachine", namespace: s.namespace, name: s.name, reason: "Drifted", message: `${s.driftCount} drifted field(s)` });
      }
      for (const vm of vms) {
        const pr = vm.status?.conditions?.find((x) => x.reason === "PowerOffRequired" || x.type === "PowerOffRequired");
        if (pr && pr.status !== "False")
          attention.push({
            kind: "VirtualMachine",
            namespace: vm.metadata.namespace ?? "",
            name: vm.metadata.name ?? "",
            reason: "PowerOffRequired",
            message: pr.message,
          });
      }
      const connected = ctxs.filter((x) => x.status?.conditions?.find((cd) => cd.type === "Connected")?.status === "True").length;
      for (const x of ctxs)
        if (x.status?.conditions?.find((cd) => cd.type === "Connected")?.status !== "True") {
          const cd = x.status?.conditions?.find((d) => d.type === "Connected");
          attention.push({
            kind: "NutanixPrismContext",
            namespace: x.metadata.namespace ?? "",
            name: x.metadata.name ?? "",
            reason: cd?.reason ?? "NotConnected",
            message: cd?.message,
          });
        }
      const stats: DashboardStats = {
        vms: {
          total: sums.length,
          byPhase,
          on: sums.filter((s) => s.powerState === "On").length,
          off: sums.filter((s) => s.powerState === "Off").length,
          ready: sums.filter((s) => s.ready === "True").length,
          notReady: sums.filter((s) => s.ready !== "True").length,
          drifted: sums.filter((s) => s.driftCount > 0).length,
          activeTasks: sums.filter((s) => s.activeTask).length,
          paused: sums.filter((s) => s.paused).length,
        },
        capacity: {
          vcpus: sums.reduce((a, s) => a + s.vcpus, 0),
          memoryBytes: sums.reduce((a, s) => a + s.memoryBytes, 0),
          diskBytes: sums.reduce((a, s) => a + s.diskBytes, 0),
        },
        byCluster: [...byCluster.values()].sort((a, b) => b.count - a.count),
        byNamespace: [...byNs.values()].sort((a, b) => b.count - a.count),
        contexts: { total: ctxs.length, connected, disconnected: ctxs.length - connected },
        services: {
          total: svcs.length,
          ready: svcs.filter((s) => s.status?.conditions?.find((cd) => cd.type === "Ready")?.status === "True").length,
          selectedVms: svcs.reduce((a, s) => a + (s.status?.selectedVms ?? 0), 0),
          readyEndpoints: svcs.reduce((a, s) => a + (s.status?.readyEndpoints ?? 0), 0),
        },
        templates: tmpls.length,
        attention: attention.slice(0, 50),
      };
      return c.json(stats);
    })
    .get("/namespaces/:ns/guest-secrets", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      const res = await userClient(c, deps)
        .listAll<Secret>(R.secrets, ns, { labelSelector: `${Labels.type}=${LabelValues.guestCustomization}` })
        .catch(() => ({ items: [] as Secret[] }));
      return c.json({
        items: res.items.map((s) => ({ name: s.metadata.name, type: s.data?.unattendXml ? "Sysprep" : "CloudInit" })),
      });
    })
    .post("/namespaces/:ns/guest-secrets", zv("param", NamespaceParam), zv("json", GuestSecretSchema), async (c) => {
      const { ns } = c.req.valid("param");
      const body = c.req.valid("json");
      const k = userClient(c, deps);
      const key = body.type === "CloudInit" ? "userData" : "unattendXml";
      const secret: Secret = {
        apiVersion: "v1",
        kind: "Secret",
        metadata: {
          name: body.name,
          namespace: ns,
          labels: { [Labels.managed]: "true", [Labels.type]: LabelValues.guestCustomization },
          annotations: userName(c) ? { [Annotations.updatedBy]: userName(c) as string } : undefined,
        },
        type: "Opaque",
        data: { [key]: Buffer.from(body.content, "utf8").toString("base64") },
      };
      try {
        const existing = await k.get<Secret>(R.secrets, ns, body.name);
        if (existing.metadata.labels?.[Labels.type] !== LabelValues.guestCustomization)
          throw new ApiError(409, "AlreadyExists", `Secret "${body.name}" already exists and is not managed by the console`);
        await k.replace(R.secrets, ns, body.name, { ...secret, metadata: { ...secret.metadata, resourceVersion: existing.metadata.resourceVersion } });
      } catch (e) {
        if (!isNotFound(e)) throw e;
        await k.create(R.secrets, ns, secret);
      }
      return c.json({ name: body.name }, 201);
    })
    .get("/stream", zv("query", z.object({ namespaces: z.string().min(1), kinds: z.string().optional() })), async (c) => {
      const id = c.get("identity");
      const q = c.req.valid("query");
      const access = await deps.access.namespaces(id);
      const allowed = new Set(access.map((a) => a.name));
      const namespaces = q.namespaces
        .split(",")
        .filter((n) => allowed.has(n))
        .slice(0, 50);
      const kinds = (q.kinds ? q.kinds.split(",") : [...WATCH_KINDS]).filter((k): k is WatchKind => (WATCH_KINDS as readonly string[]).includes(k));
      return streamSSE(c, async (stream) => {
        const queue: StreamMessage[] = [];
        let wake: (() => void) | undefined;
        const push = (m: StreamMessage) => {
          queue.push(m);
          wake?.();
        };
        const unsubs: (() => void)[] = [];
        for (const ns of namespaces) {
          const perms = access.find((a) => a.name === ns)?.permissions;
          for (const kind of kinds) {
            const resource = kind === "configmaps" ? "configmaps" : kind;
            if (!perms?.[resource]?.list) continue;
            unsubs.push(deps.hub.subscribe(id, ns, kind, push));
          }
        }
        let closed = false;
        stream.onAbort(() => {
          closed = true;
          wake?.();
        });
        await stream.writeSSE({ event: "ready", data: JSON.stringify({ namespaces, kinds }) });
        try {
          while (!closed) {
            if (!queue.length)
              await new Promise<void>((r) => {
                wake = r;
                setTimeout(r, 25_000);
              });
            wake = undefined;
            if (closed) break;
            if (!queue.length) {
              await stream.writeSSE({ event: "ping", data: String(Date.now()) });
              continue;
            }
            const batch = queue.splice(0, 200);
            await stream.writeSSE({ event: "batch", data: JSON.stringify(batch) });
          }
        } finally {
          for (const u of unsubs) u();
        }
      });
    });
}
