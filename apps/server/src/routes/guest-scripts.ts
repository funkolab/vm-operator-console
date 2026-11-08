import { GuestScriptCreateSchema, type GuestScriptSummary, GuestScriptUpdateSchema, NamedParam, NamespaceParam } from "@console/shared";
import { Hono } from "hono";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient, userName } from "../context";
import { zv } from "./validate";

/** Cloud-init and Sysprep scripts (Secrets) referenced by VMs and templates. */
export function guestScriptRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/guest-secrets", async (c) => {
      const k = userClient(c, deps);
      const nsList = await deps.access.namespaces(c.get("identity"));
      const allowed = nsList.filter((n) => n.permissions.secrets?.list).map((n) => n.name);
      const res = await Promise.all(allowed.map((ns) => deps.guestScripts.list(k, ns).catch(() => [] as GuestScriptSummary[])));
      return c.json({ items: res.flat() });
    })
    .get("/namespaces/:ns/guest-secrets", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.guestScripts.list(userClient(c, deps), ns).catch(() => [] as GuestScriptSummary[]) });
    })
    .post("/namespaces/:ns/guest-secrets", zv("param", NamespaceParam), zv("json", GuestScriptCreateSchema), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json(await deps.guestScripts.create(userClient(c, deps), ns, c.req.valid("json"), userName(c)), 201);
    })
    .get("/namespaces/:ns/guest-secrets/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.guestScripts.get(userClient(c, deps), ns, name));
    })
    .put("/namespaces/:ns/guest-secrets/:name", zv("param", NamedParam), zv("json", GuestScriptUpdateSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.guestScripts.update(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)));
    })
    .delete("/namespaces/:ns/guest-secrets/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.guestScripts.delete(userClient(c, deps), ns, name);
      return c.json({ ok: true });
    });
}
