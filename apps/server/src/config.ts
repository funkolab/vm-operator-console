import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const ConfigSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default("0.0.0.0"),
    BASE_PATH: z
      .string()
      .default("")
      .transform((v) => v.replace(/\/+$/, ""))
      .refine((v) => v === "" || v.startsWith("/"), "BASE_PATH must start with /"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    STATIC_DIR: z.string().optional(),

    K8S_MODE: z.enum(["auto", "in-cluster", "kubeconfig"]).default("auto"),
    KUBECONFIG: z.string().optional(),
    K8S_CONTEXT: z.string().optional(),
    K8S_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(30000),
    /** Restricts the namespaces the console considers; empty means all. */
    WATCH_NAMESPACES: csv,

    /** traefik: identity from forward-auth headers; dev: fixed identity; none: kubeconfig identity (no impersonation). */
    AUTH_MODE: z.enum(["traefik", "dev", "none"]).default("traefik"),
    AUTH_USER_HEADER: z.string().default("X-Forwarded-User"),
    AUTH_GROUPS_HEADER: z.string().default("X-Forwarded-Groups"),
    AUTH_GROUPS_SEPARATOR: z.string().default(","),
    AUTH_EXTRA_GROUPS: csv,
    AUTH_TRUSTED_PROXIES: csv,
    AUTH_DEBUG: bool,
    DEV_USER: z.string().default("dev-admin"),
    DEV_GROUPS: csv,
    PERMISSIONS_TTL_SECONDS: z.coerce.number().int().min(0).default(60),

    PRISM_PROXY_ENABLED: bool.default(true),
    PRISM_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(120),
    PRISM_REQUEST_TIMEOUT_MS: z.coerce.number().int().default(15000),

    APP_VERSION: z.string().default("dev"),
  })
  .superRefine((c, ctx) => {
    if (c.AUTH_MODE === "dev" && process.env.KUBERNETES_SERVICE_HOST && !process.env.ALLOW_DEV_AUTH_IN_CLUSTER)
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=dev is refused when running inside a cluster (set ALLOW_DEV_AUTH_IN_CLUSTER=1 to override)",
      });
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return parsed.data;
}
