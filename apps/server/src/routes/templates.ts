import { DryRunQuery, InstantiateRequestSchema, NamedParam, NamespaceParam } from "@console/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient, userName } from "../context";
import type { TemplateListItem } from "../services/templates";
import { zv } from "./validate";

const TemplateBody = z.record(z.string(), z.unknown());

export function templateRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/templates", async (c) => {
      const k = userClient(c, deps);
      const nsList = await deps.access.namespaces(c.get("identity"));
      const allowed = nsList.filter((n) => n.permissions.configmaps?.list).map((n) => n.name);
      const res = await Promise.all(allowed.map((ns) => deps.templates.list(k, ns).catch(() => [] as TemplateListItem[])));
      return c.json({ items: res.flat() });
    })
    .get("/namespaces/:ns/templates", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.templates.list(userClient(c, deps), ns) });
    })
    .post("/namespaces/:ns/templates", zv("param", NamespaceParam), zv("query", DryRunQuery), zv("json", TemplateBody), async (c) => {
      const { ns } = c.req.valid("param");
      const t = await deps.templates.create(userClient(c, deps), ns, c.req.valid("json"), userName(c), c.req.valid("query").dryRun === "true");
      return c.json(t, 201);
    })
    .post("/namespaces/:ns/templates/validate", zv("param", NamespaceParam), zv("json", TemplateBody), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json(await deps.templates.validate(userClient(c, deps), c.req.valid("json"), ns));
    })
    .get("/namespaces/:ns/templates/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.templates.get(userClient(c, deps), ns, name));
    })
    .put("/namespaces/:ns/templates/:name", zv("param", NamedParam), zv("json", TemplateBody), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.templates.update(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)));
    })
    .delete("/namespaces/:ns/templates/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.templates.delete(userClient(c, deps), ns, name);
      return c.json({ ok: true });
    })
    .post(
      "/namespaces/:ns/templates/:name/duplicate",
      zv("param", NamedParam),
      zv("json", z.object({ name: z.string().min(1).max(58), displayName: z.string().optional(), namespace: z.string().optional() })),
      async (c) => {
        const { ns, name } = c.req.valid("param");
        return c.json(await deps.templates.duplicate(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)), 201);
      },
    )
    .post(
      "/namespaces/:ns/templates/:name/render",
      zv("param", NamedParam),
      zv("json", z.object({ values: z.record(z.string(), z.unknown()).default({}), name: z.string().optional() })),
      async (c) => {
        const { ns, name } = c.req.valid("param");
        const body = c.req.valid("json");
        return c.json(await deps.templates.render(userClient(c, deps), ns, name, body.values, body.name));
      },
    )
    .post("/namespaces/:ns/templates/:name/instantiate", zv("param", NamedParam), zv("json", InstantiateRequestSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.templates.instantiate(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)));
    })
    .get("/namespaces/:ns/templates/:name/vms", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json({ items: await deps.templates.vmsFromTemplate(userClient(c, deps), ns, name) });
    });
}
