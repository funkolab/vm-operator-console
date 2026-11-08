import type { Context } from "hono";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { type AppEnv, identityMiddleware } from "./auth/identity";
import type { Deps } from "./context";
import { errorHandler } from "./errors";
import { log } from "./log";
import { contextRoutes } from "./routes/contexts";
import { guestScriptRoutes } from "./routes/guest-scripts";
import { systemRoutes } from "./routes/system";
import { templateRoutes } from "./routes/templates";
import { vmRoutes } from "./routes/vms";
import { vmServiceRoutes } from "./routes/vmservices";
import { serveSpa } from "./static";

export function createApi(deps: Deps, remoteAddr: (c: Context) => string | undefined = () => undefined) {
  return new Hono<AppEnv>()
    .use("*", identityMiddleware(deps.cfg, remoteAddr))
    .route("/", systemRoutes(deps))
    .route("/", vmRoutes(deps))
    .route("/", templateRoutes(deps))
    .route("/", contextRoutes(deps))
    .route("/", guestScriptRoutes(deps))
    .route("/", vmServiceRoutes(deps));
}

/** The typed API surface used by the frontend Hono RPC client. */
export type ApiType = ReturnType<typeof createApi>;

export function createApp(deps: Deps, opts: { remoteAddr?: (c: Context) => string | undefined; staticDir?: string } = {}) {
  const root = new Hono<AppEnv>({ strict: false });
  const app = deps.cfg.BASE_PATH ? root.basePath(deps.cfg.BASE_PATH) : root;

  app.onError(errorHandler);
  app.use("*", requestId());
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        frameAncestors: ["'self'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use("/api/*", async (c, next) => {
    const start = performance.now();
    await next();
    if (c.req.path.endsWith("/stream")) return;
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      user: c.get("identity")?.user,
      requestId: c.get("requestId"),
    });
  });
  app.use("/api/*", csrf());
  app.use("/api/*", async (c, next) => {
    if (c.req.path.endsWith("/stream")) return next();
    return compress()(c, next);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/readyz", async (c) => {
    const r = await deps.readiness();
    return c.json(r, r.ok ? 200 : 503);
  });
  app.get("/api/version", (c) => c.json({ version: deps.cfg.APP_VERSION, authMode: deps.cfg.AUTH_MODE, basePath: deps.cfg.BASE_PATH }));
  app.route("/api", createApi(deps, opts.remoteAddr));
  app.all("/api/*", (c) => c.json({ error: { code: "NotFound", message: "Not found", status: 404 } }, 404));

  if (opts.staticDir) serveSpa(app, opts.staticDir, deps.cfg.BASE_PATH);
  return root;
}
