import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { websocket } from "hono/bun";
import { createApp } from "./app";
import { AccessService } from "./auth/access";
import { loadConfig } from "./config";
import type { Deps } from "./context";
import { KubeClient, R } from "./k8s/client";
import { loadClusterConnection } from "./k8s/kubeconfig";
import { Transport } from "./k8s/transport";
import { log, setLogLevel } from "./log";
import { ConsoleProxy } from "./prism/console";
import { InsightsService } from "./prism/insights";
import { PrismService } from "./prism/service";
import { PowerScheduler } from "./scheduler/scheduler";
import { ContextService } from "./services/contexts";
import { GuestScriptService } from "./services/guest-scripts";
import { TemplateService } from "./services/templates";
import { VMService } from "./services/vms";
import { VMServiceService } from "./services/vmservices";
import { StreamHub } from "./stream/hub";

const cfg = loadConfig();
setLogLevel(cfg.LOG_LEVEL);

const conn = loadClusterConnection(cfg);
const transport = new Transport(conn);
const sa = new KubeClient(transport, undefined, cfg.K8S_REQUEST_TIMEOUT_MS);
const vms = new VMService();
const templates = new TemplateService();

let lastReady = { at: 0, ok: false, message: "not checked" as string | undefined };
const prism = new PrismService(sa, cfg);
const scheduler = cfg.SCHEDULER_ENABLED ? new PowerScheduler(sa, { namespace: cfg.POD_NAMESPACE, namespaces: cfg.WATCH_NAMESPACES }) : undefined;
const deps: Deps = {
  cfg,
  sa,
  access: new AccessService(sa, cfg.PERMISSIONS_TTL_SECONDS * 1000, cfg.WATCH_NAMESPACES),
  prism,
  insights: new InsightsService(prism, cfg),
  console: new ConsoleProxy(),
  vms,
  templates,
  contexts: new ContextService(),
  guestScripts: new GuestScriptService(templates),
  vmServices: new VMServiceService(),
  hub: new StreamHub(sa, vms),
  scheduler,
  readiness: async () => {
    if (Date.now() - lastReady.at < 5000) return { ok: lastReady.ok, message: lastReady.message };
    try {
      await sa.raw("GET", "/readyz").catch(async () => sa.list(R.namespaces, undefined, { limit: 1 }));
      // The CRDs from vm-operator must be installed.
      await sa.raw("GET", "/apis/vmm.v4.nutanix.com/v1alpha1");
      lastReady = { at: Date.now(), ok: true, message: undefined };
    } catch (e) {
      lastReady = { at: Date.now(), ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    return { ok: lastReady.ok, message: lastReady.message };
  },
};

function findStaticDir(): string | undefined {
  const candidates = [
    cfg.STATIC_DIR,
    join(dirname(process.execPath), "public"),
    resolve(import.meta.dir, "../../web/dist"),
    resolve(process.cwd(), "public"),
  ].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, "index.html")));
}

const staticDir = findStaticDir();
let server: ReturnType<typeof Bun.serve>;
const app = createApp(deps, {
  staticDir,
  remoteAddr: (c) => server?.requestIP(c.req.raw)?.address,
});

server = Bun.serve({
  port: cfg.PORT,
  hostname: cfg.HOST,
  fetch: app.fetch,
  websocket,
  idleTimeout: 0, // SSE streams are long-lived
});
scheduler?.start();

log.info("vm-operator-console started", {
  url: `http://${cfg.HOST}:${cfg.PORT}${cfg.BASE_PATH}/`,
  k8sMode: conn.mode,
  server: conn.server,
  context: conn.contextName,
  authMode: cfg.AUTH_MODE,
  staticDir: staticDir ?? "(none)",
  version: cfg.APP_VERSION,
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutting down", { signal });
  deps.hub.stopAll();
  scheduler?.stop();
  await server.stop();
  transport.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
