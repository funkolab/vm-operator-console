import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config";
import { ApiError } from "../errors";
import type { Identity } from "../k8s/client";

const RESERVED_GROUP_PREFIX = "system:";

function ipToBigInt(ip: string): { v: bigint; bits: number } | undefined {
  const clean = ip.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    const parts = clean.split(".").map(Number);
    if (parts.some((p) => p > 255)) return undefined;
    return { v: parts.reduce((a, p) => (a << 8n) + BigInt(p), 0n), bits: 32 };
  }
  if (clean.includes(":")) {
    const [head, tail] = clean.split("::") as [string, string | undefined];
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
    const groups = [...h, ...fill, ...t];
    if (groups.length !== 8) return undefined;
    return { v: groups.reduce((a, g) => (a << 16n) + BigInt(Number.parseInt(g || "0", 16)), 0n), bits: 128 };
  }
  return undefined;
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  const addr = ipToBigInt(ip);
  if (!addr) return false;
  return cidrs.some((cidr) => {
    const [base, lenStr] = cidr.split("/") as [string, string | undefined];
    const net = ipToBigInt(base);
    if (!net || net.bits !== addr.bits) return false;
    const len = lenStr === undefined ? net.bits : Number(lenStr);
    const shift = BigInt(net.bits - len);
    return addr.v >> shift === net.v >> shift;
  });
}

export type AppEnv = {
  Variables: {
    identity: Identity | undefined;
    requestId: string;
  };
};

export function parseGroups(raw: string | undefined, sep: string): string[] {
  if (!raw) return [];
  return raw
    .split(sep)
    .map((g) => g.trim())
    .filter((g) => g && !g.startsWith(RESERVED_GROUP_PREFIX));
}

/**
 * Resolves the end-user identity:
 * - traefik: from the forward-auth headers set by the NKP Traefik remote-auth middleware;
 * - dev: a fixed identity for local development (still impersonated);
 * - none: no impersonation, the kubeconfig/ServiceAccount identity is used.
 * There is never a silent fallback to the ServiceAccount's own permissions.
 */
export function identityMiddleware(cfg: Config, remoteAddr: (c: Context) => string | undefined): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (cfg.AUTH_MODE === "none") {
      c.set("identity", undefined);
      return next();
    }
    if (cfg.AUTH_MODE === "dev") {
      // Tests may switch user via x-dev-user / x-dev-groups; DEV_GROUPS only applies to DEV_USER.
      const override = c.req.header("x-dev-user");
      const user = override || cfg.DEV_USER;
      const groups = override ? parseGroups(c.req.header("x-dev-groups"), ",") : cfg.DEV_GROUPS;
      c.set("identity", { user, groups: [...groups, ...cfg.AUTH_EXTRA_GROUPS] });
      return next();
    }
    if (cfg.AUTH_TRUSTED_PROXIES.length) {
      const ip = remoteAddr(c);
      if (!ip || !ipInCidrs(ip, cfg.AUTH_TRUSTED_PROXIES))
        throw new ApiError(403, "UntrustedProxy", "Request did not come through the trusted authentication proxy");
    }
    const user = c.req.header(cfg.AUTH_USER_HEADER)?.trim();
    if (!user || user.startsWith(RESERVED_GROUP_PREFIX))
      throw new ApiError(401, "Unauthenticated", "No authenticated user was provided by the authentication proxy");
    const groups = parseGroups(c.req.header(cfg.AUTH_GROUPS_HEADER), cfg.AUTH_GROUPS_SEPARATOR);
    c.set("identity", { user, groups: [...new Set([...groups, ...cfg.AUTH_EXTRA_GROUPS])] });
    return next();
  };
}
