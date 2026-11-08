import { DryRunQuery, LabelSelectorSchema, NamedParam, NamespaceParam, type VirtualMachineService, VirtualMachineServiceSchema } from "@console/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient } from "../context";
import { zv } from "./validate";

export function vmServiceRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/services", async (c) => {
      const k = userClient(c, deps);
      const nsList = await deps.access.namespaces(c.get("identity"));
      const allowed = nsList.filter((n) => n.permissions.virtualmachineservices?.list).map((n) => n.name);
      const res = await Promise.all(allowed.map((ns) => deps.vmServices.list(k, ns).catch(() => [] as VirtualMachineService[])));
      return c.json({ items: res.flat() });
    })
    .get("/namespaces/:ns/services", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.vmServices.list(userClient(c, deps), ns) });
    })
    .post("/namespaces/:ns/services", zv("param", NamespaceParam), zv("query", DryRunQuery), zv("json", VirtualMachineServiceSchema), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json(await deps.vmServices.create(userClient(c, deps), ns, c.req.valid("json"), c.req.valid("query").dryRun === "true"), 201);
    })
    .post("/namespaces/:ns/services/preview-selector", zv("param", NamespaceParam), zv("json", z.object({ selector: LabelSelectorSchema })), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json(await deps.vmServices.previewSelector(userClient(c, deps), ns, c.req.valid("json").selector));
    })
    .get("/namespaces/:ns/services/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.vmServices.get(userClient(c, deps), ns, name));
    })
    .put("/namespaces/:ns/services/:name", zv("param", NamedParam), zv("json", VirtualMachineServiceSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.vmServices.update(userClient(c, deps), ns, name, c.req.valid("json")));
    })
    .delete("/namespaces/:ns/services/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.vmServices.delete(userClient(c, deps), ns, name);
      return c.json({ ok: true });
    });
}
