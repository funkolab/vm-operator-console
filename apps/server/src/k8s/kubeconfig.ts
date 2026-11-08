import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse } from "yaml";
import type { Config } from "../config";

const execFileAsync = promisify(execFile);

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export interface ClusterConnection {
  mode: "in-cluster" | "kubeconfig";
  server: string;
  ca?: Buffer;
  insecureSkipTLSVerify?: boolean;
  cert?: Buffer;
  key?: Buffer;
  /** Returns the current bearer token (re-read for projected SA tokens and exec plugins). */
  token?: () => Promise<string | undefined>;
  /** Basic auth, kubeconfig only. */
  basic?: { username: string; password: string };
  contextName?: string;
  namespace?: string;
}

interface KubeconfigFile {
  "current-context"?: string;
  clusters?: { name: string; cluster: Record<string, unknown> }[];
  users?: { name: string; user: Record<string, unknown> }[];
  contexts?: { name: string; context: { cluster: string; user: string; namespace?: string } }[];
}

function readMaybe(base: string, data?: unknown, file?: unknown): Buffer | undefined {
  if (typeof data === "string" && data) return Buffer.from(data, "base64");
  if (typeof file === "string" && file) return readFileSync(isAbsolute(file) ? file : resolve(base, file));
  return undefined;
}

function inClusterConnection(): ClusterConnection {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set; not running in a cluster");
  const tokenPath = join(SA_DIR, "token");
  let cached: { value: string; readAt: number } | undefined;
  return {
    mode: "in-cluster",
    server: `https://${host.includes(":") ? `[${host}]` : host}:${port}`,
    ca: readFileSync(join(SA_DIR, "ca.crt")),
    // Projected tokens rotate; re-read at most once a minute.
    token: async () => {
      if (!cached || Date.now() - cached.readAt > 60_000) cached = { value: readFileSync(tokenPath, "utf8").trim(), readAt: Date.now() };
      return cached.value;
    },
    namespace: existsSync(join(SA_DIR, "namespace")) ? readFileSync(join(SA_DIR, "namespace"), "utf8").trim() : undefined,
  };
}

function execTokenProvider(exec: Record<string, unknown>): () => Promise<string | undefined> {
  let cache: { token: string; expires: number } | undefined;
  return async () => {
    if (cache && cache.expires > Date.now() + 30_000) return cache.token;
    const env = { ...process.env } as Record<string, string>;
    for (const e of (exec.env as { name: string; value: string }[] | undefined) ?? []) env[e.name] = e.value;
    const { stdout } = await execFileAsync(String(exec.command), (exec.args as string[] | undefined) ?? [], { env });
    const cred = JSON.parse(stdout) as { status?: { token?: string; expirationTimestamp?: string } };
    const token = cred.status?.token;
    if (!token) throw new Error("exec credential plugin returned no token");
    const exp = cred.status?.expirationTimestamp ? Date.parse(cred.status.expirationTimestamp) : Date.now() + 5 * 60_000;
    cache = { token, expires: exp };
    return token;
  };
}

function kubeconfigConnection(path: string | undefined, contextName: string | undefined): ClusterConnection {
  const candidates = (path ?? process.env.KUBECONFIG ?? join(homedir(), ".kube", "config")).split(":").filter(Boolean);
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error(`No kubeconfig found (looked at ${candidates.join(", ")})`);
  const kc = parse(readFileSync(file, "utf8")) as KubeconfigFile;
  const base = dirname(file);
  const ctxName = contextName ?? kc["current-context"];
  const ctx = kc.contexts?.find((c) => c.name === ctxName);
  if (!ctx) throw new Error(`Context "${ctxName}" not found in ${file}`);
  const cluster = kc.clusters?.find((c) => c.name === ctx.context.cluster)?.cluster;
  const user = kc.users?.find((u) => u.name === ctx.context.user)?.user ?? {};
  if (!cluster) throw new Error(`Cluster "${ctx.context.cluster}" not found in ${file}`);
  const staticToken =
    typeof user.token === "string" ? user.token : typeof user.tokenFile === "string" ? readFileSync(resolve(base, user.tokenFile), "utf8").trim() : undefined;
  return {
    mode: "kubeconfig",
    server: String(cluster.server).replace(/\/+$/, ""),
    ca: readMaybe(base, cluster["certificate-authority-data"], cluster["certificate-authority"]),
    insecureSkipTLSVerify: cluster["insecure-skip-tls-verify"] === true,
    cert: readMaybe(base, user["client-certificate-data"], user["client-certificate"]),
    key: readMaybe(base, user["client-key-data"], user["client-key"]),
    token: staticToken ? async () => staticToken : user.exec ? execTokenProvider(user.exec as Record<string, unknown>) : undefined,
    basic: typeof user.username === "string" && typeof user.password === "string" ? { username: user.username, password: user.password } : undefined,
    contextName: ctxName,
    namespace: ctx.context.namespace,
  };
}

export function loadClusterConnection(cfg: Config): ClusterConnection {
  const mode = cfg.K8S_MODE === "auto" ? (process.env.KUBERNETES_SERVICE_HOST ? "in-cluster" : "kubeconfig") : cfg.K8S_MODE;
  return mode === "in-cluster" ? inClusterConnection() : kubeconfigConnection(cfg.KUBECONFIG, cfg.K8S_CONTEXT);
}
