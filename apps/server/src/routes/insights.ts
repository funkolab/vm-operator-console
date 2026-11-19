import { METRIC_RANGE_KEYS, NamedParam, type VirtualMachine } from "@console/shared";
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient } from "../context";
import { ApiError } from "../errors";
import { R } from "../k8s/client";
import { log } from "../log";
import { isSameOrigin } from "../prism/console";
import type { ResolvedVM } from "../prism/insights";
import { zv } from "./validate";

/** Prism Central live insights (metrics, placement, tasks, infrastructure) and the VM console. */
export function insightRoutes(deps: Deps) {
  /** Every VM the user can list, across accessible namespaces (impersonated). */
  const visibleVMs = async (c: Parameters<typeof userClient>[0], only?: string) => {
    const k = userClient(c, deps);
    const nsList = (await deps.access.namespaces(c.get("identity"))).filter((n) => n.permissions.virtualmachines?.list && (!only || n.name === only));
    const res = await Promise.all(
      nsList.map((n) =>
        k
          .listAll<VirtualMachine>(R.virtualmachines, n.name)
          .then((r) => r.items)
          .catch(() => [] as VirtualMachine[]),
      ),
    );
    return res.flat();
  };

  return new Hono<AppEnv>()
    .get("/namespaces/:ns/vms/:name/metrics", zv("param", NamedParam), zv("query", z.object({ range: z.enum(METRIC_RANGE_KEYS).default("1h") })), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.insights.metrics(userClient(c, deps), ns, name, c.req.valid("query").range));
    })
    .get("/namespaces/:ns/vms/:name/placement", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.insights.placement(userClient(c, deps), ns, name));
    })
    .get("/namespaces/:ns/vms/:name/task", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.insights.task(userClient(c, deps), ns, name));
    })
    .get("/namespaces/:ns/contexts/:name/infrastructure", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.insights.infrastructure(userClient(c, deps), ns, name, await visibleVMs(c)));
    })
    .get("/insights/top", zv("query", z.object({ namespace: z.string().optional(), limit: z.coerce.number().int().min(1).max(20).default(8) })), async (c) => {
      const q = c.req.valid("query");
      return c.json(await deps.insights.topConsumers(userClient(c, deps), await visibleVMs(c, q.namespace), q.limit));
    })
    .get(
      "/namespaces/:ns/vms/:name/console",
      zv("param", NamedParam),
      async (c, next) => {
        // Upgrade authorization happens before the websocket handshake.
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new ApiError(426, "UpgradeRequired", "Websocket upgrade required");
        if (!isSameOrigin(c.req.header("origin"), c.req.header("host"), c.req.header("x-forwarded-host")))
          throw new ApiError(403, "CrossOrigin", "Console connections must come from the console origin");
        const { ns, name } = c.req.valid("param");
        if (!(await deps.access.check(c.get("identity"), "update", "virtualmachines", ns)))
          throw new ApiError(403, "Forbidden", "Opening the console requires permission to update this VM");
        const k = userClient(c, deps);
        const resolved = await deps.insights.resolveVM(k, ns, name);
        if (resolved.vm.status?.powerState !== "On") throw new ApiError(409, "PoweredOff", "The VM must be powered on to open its console");
        const placement = await deps.insights.placement(k, ns, name);
        consoles.set(c.req.raw, { resolved, cluster: placement.cluster?.extId, user: c.get("identity")?.user });
        await next();
      },
      upgradeWebSocket((c) => {
        const target = consoles.get(c.req.raw);
        consoles.delete(c.req.raw);
        let upstream: WebSocket | undefined;
        const pending: ArrayBuffer[] = [];
        let closed = false;
        return {
          onOpen(_evt, ws) {
            if (!target) return ws.close(1011, "Console not authorized");
            log.info("Console opened", { ns: target.resolved.vm.metadata.namespace, vm: target.resolved.vm.metadata.name, user: target.user });
            deps.console
              .open(target.resolved, target.cluster)
              .then((up) => {
                if (closed) return up.close();
                upstream = up;
                for (const m of pending.splice(0)) up.send(m);
                up.onmessage = (m) => ws.send(new Uint8Array(m.data as ArrayBuffer));
                up.onclose = (e) => {
                  if (!closed) ws.close(e.code === 1006 ? 1011 : e.code || 1000, e.reason || "Console closed by Prism Central");
                };
                up.onerror = () => ws.close(1011, "Console connection error");
              })
              .catch((e: Error) => {
                log.warn("Console connection failed", { error: e.message });
                ws.close(1011, e.message.slice(0, 120));
              });
          },
          onMessage(evt) {
            const data = evt.data;
            const buf = typeof data === "string" ? new TextEncoder().encode(data).buffer : data instanceof Blob ? undefined : (data as ArrayBuffer);
            if (!buf) return;
            if (upstream?.readyState === WebSocket.OPEN) upstream.send(buf);
            else pending.push(buf as ArrayBuffer);
          },
          onClose() {
            closed = true;
            upstream?.close();
          },
        };
      }),
    );
}

const consoles = new WeakMap<Request, { resolved: ResolvedVM; cluster?: string; user?: string }>();
