import {
  BulkActionSchema,
  CloneRequestSchema,
  DryRunQuery,
  NamedParam,
  NamespaceParam,
  PowerActionSchema,
  SaveAsTemplateRequestSchema,
  type VirtualMachine,
  VirtualMachineSchema,
} from "@console/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient, userName } from "../context";
import { zv } from "./validate";

const UpdateQuery = DryRunQuery.extend({
  confirmDiskDeletion: z.enum(["true", "false"]).optional(),
  confirmBootDiskDeletion: z.enum(["true", "false"]).optional(),
});

export function vmRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/vms", zv("query", z.object({ labelSelector: z.string().optional() })), async (c) => {
      const k = userClient(c, deps);
      const nsList = await deps.access.namespaces(c.get("identity"));
      const allowed = nsList.filter((n) => n.permissions.virtualmachines?.list).map((n) => n.name);
      const { labelSelector } = c.req.valid("query");
      const results = await Promise.all(allowed.map((ns) => deps.vms.list(k, ns, labelSelector).catch(() => [] as VirtualMachine[])));
      return c.json({ items: results.flat() });
    })
    .get("/namespaces/:ns/vms", zv("param", NamespaceParam), zv("query", z.object({ labelSelector: z.string().optional() })), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.vms.list(userClient(c, deps), ns, c.req.valid("query").labelSelector) });
    })
    .post("/namespaces/:ns/vms", zv("param", NamespaceParam), zv("query", DryRunQuery), zv("json", VirtualMachineSchema), async (c) => {
      const { ns } = c.req.valid("param");
      const vm = await deps.vms.create(userClient(c, deps), ns, c.req.valid("json"), {
        dryRun: c.req.valid("query").dryRun === "true",
        user: userName(c),
      });
      return c.json(vm, 201);
    })
    .post("/vms/bulk", zv("json", BulkActionSchema), async (c) => {
      return c.json(await deps.vms.bulk(userClient(c, deps), c.req.valid("json"), userName(c)));
    })
    .get("/namespaces/:ns/vms/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.vms.get(userClient(c, deps), ns, name));
    })
    .put("/namespaces/:ns/vms/:name", zv("param", NamedParam), zv("query", UpdateQuery), zv("json", VirtualMachineSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      const q = c.req.valid("query");
      return c.json(
        await deps.vms.update(userClient(c, deps), ns, name, c.req.valid("json"), {
          dryRun: q.dryRun === "true",
          user: userName(c),
          confirmDiskDeletion: q.confirmDiskDeletion === "true",
          confirmBootDiskDeletion: q.confirmBootDiskDeletion === "true",
        }),
      );
    })
    .patch(
      "/namespaces/:ns/vms/:name/metadata",
      zv("param", NamedParam),
      zv(
        "json",
        z.object({
          labels: z.record(z.string(), z.string().nullable()).optional(),
          annotations: z.record(z.string(), z.string().nullable()).optional(),
        }),
      ),
      async (c) => {
        const { ns, name } = c.req.valid("param");
        return c.json(await deps.vms.patchMetadata(userClient(c, deps), ns, name, c.req.valid("json")));
      },
    )
    .delete("/namespaces/:ns/vms/:name", zv("param", NamedParam), zv("query", DryRunQuery), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.vms.delete(userClient(c, deps), ns, name, { dryRun: c.req.valid("query").dryRun === "true" });
      return c.json({ ok: true });
    })
    .post("/namespaces/:ns/vms/:name/actions/:action", zv("param", NamedParam.extend({ action: PowerActionSchema })), async (c) => {
      const { ns, name, action } = c.req.valid("param");
      return c.json(await deps.vms.power(userClient(c, deps), ns, name, action));
    })
    .post("/namespaces/:ns/vms/:name/clone", zv("param", NamedParam), zv("json", CloneRequestSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.vms.clone(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)), 201);
    })
    .post("/namespaces/:ns/vms/:name/save-as-template", zv("param", NamedParam), zv("json", SaveAsTemplateRequestSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.templates.saveFromVM(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)), 201);
    })
    .get("/namespaces/:ns/vms/:name/events", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json({ items: await deps.vms.events(userClient(c, deps), ns, name) });
    })
    .get("/namespaces/:ns/vms/:name/services", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      const k = userClient(c, deps);
      const vm = await deps.vms.get(k, ns, name);
      return c.json({ items: await deps.vms.servicesFor(k, vm) });
    });
}
