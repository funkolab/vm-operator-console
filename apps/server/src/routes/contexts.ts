import { CATALOG_KINDS, NamedParam, NamespaceParam, PrismAccountRequestSchema, RotateCredentialSchema, TestConnectionSchema } from "@console/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth/identity";
import { type Deps, userClient, userName } from "../context";
import type { ContextView } from "../services/contexts";
import { UpdateAccountSchema } from "../services/contexts";
import { zv } from "./validate";

export function contextRoutes(deps: Deps) {
  return new Hono<AppEnv>()
    .get("/contexts", async (c) => {
      const k = userClient(c, deps);
      const nsList = await deps.access.namespaces(c.get("identity"));
      const allowed = nsList.filter((n) => n.permissions.nutanixprismcontexts?.list).map((n) => n.name);
      const res = await Promise.all(allowed.map((ns) => deps.contexts.list(k, ns).catch(() => [] as ContextView[])));
      return c.json({ items: res.flat() });
    })
    .get("/namespaces/:ns/contexts", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.contexts.list(userClient(c, deps), ns) });
    })
    .post("/namespaces/:ns/contexts", zv("param", NamespaceParam), zv("json", PrismAccountRequestSchema), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json(await deps.contexts.createAccount(userClient(c, deps), ns, c.req.valid("json"), userName(c)), 201);
    })
    .post("/contexts/test", zv("json", TestConnectionSchema), async (c) => {
      const b = c.req.valid("json");
      return c.json(
        await deps.prism.test({
          address: b.address,
          port: b.port,
          insecure: b.tlsMode === "Insecure",
          caBundle: b.caBundle,
          ...(b.credential.mode === "basic" ? { username: b.credential.username, password: b.credential.password } : { apiKey: b.credential.apiKey }),
        }),
      );
    })
    .get("/namespaces/:ns/credential-secrets", zv("param", NamespaceParam), async (c) => {
      const { ns } = c.req.valid("param");
      return c.json({ items: await deps.contexts.listCredentialSecrets(userClient(c, deps), ns).catch(() => []) });
    })
    .get("/namespaces/:ns/contexts/:name", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.contexts.get(userClient(c, deps), ns, name));
    })
    .get("/namespaces/:ns/contexts/:name/usage", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json({ vms: await deps.contexts.usedBy(userClient(c, deps), ns, name) });
    })
    .patch("/namespaces/:ns/contexts/:name", zv("param", NamedParam), zv("json", UpdateAccountSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.contexts.updateEndpoint(userClient(c, deps), ns, name, c.req.valid("json"), userName(c)));
    })
    .put("/namespaces/:ns/contexts/:name/credential", zv("param", NamedParam), zv("json", RotateCredentialSchema), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.contexts.rotateCredential(userClient(c, deps), ns, name, c.req.valid("json"), userName(c));
      deps.prism.clearCache();
      return c.json({ ok: true });
    })
    .post("/namespaces/:ns/contexts/:name/test", zv("param", NamedParam), async (c) => {
      const { ns, name } = c.req.valid("param");
      return c.json(await deps.prism.testContext(userClient(c, deps), ns, name));
    })
    .delete("/namespaces/:ns/contexts/:name", zv("param", NamedParam), zv("query", z.object({ force: z.enum(["true", "false"]).optional() })), async (c) => {
      const { ns, name } = c.req.valid("param");
      await deps.contexts.delete(userClient(c, deps), ns, name, c.req.valid("query").force === "true");
      return c.json({ ok: true });
    })
    .get(
      "/namespaces/:ns/contexts/:name/catalog/:kind",
      zv("param", NamedParam.extend({ kind: z.enum(CATALOG_KINDS) })),
      zv("query", z.object({ refresh: z.enum(["true", "false"]).optional() })),
      async (c) => {
        const { ns, name, kind } = c.req.valid("param");
        return c.json(await deps.prism.catalog(userClient(c, deps), ns, name, kind, c.req.valid("query").refresh === "true"));
      },
    );
}
