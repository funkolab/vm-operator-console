import type { CatalogKind, CatalogResponse, NutanixPrismContext, Secret, TestConnectionResult } from "@console/shared";
import type { Config } from "../config";
import { ApiError } from "../errors";
import { type Identity, type KubeClient, R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { log } from "../log";
import { PrismClient, type PrismCredentials, PrismError } from "./client";

const decode = (s?: string) => (s ? Buffer.from(s, "base64").toString("utf8") : undefined);

/**
 * Prism Central catalog proxy. The user must be able to `get` the
 * NutanixPrismContext (checked by reading it with impersonation). Credentials
 * are then read with the console ServiceAccount, never returned to clients.
 */
export class PrismService {
  private cache = new Map<string, { expires: number; value: CatalogResponse }>();

  constructor(
    private readonly sa: KubeClient,
    private readonly cfg: Config,
  ) {}

  async credentialsFor(ctx: NutanixPrismContext): Promise<PrismCredentials> {
    const ns = ctx.metadata.namespace as string;
    const credNs = ctx.spec.credential.namespace || ns;
    const credName = ctx.spec.credential.name;
    if (!credName) throw new ApiError(422, "CredentialMissing", "The context has no credential secret");
    let secret: Secret;
    try {
      secret = await this.sa.get<Secret>(R.secrets, credNs, credName);
    } catch (e) {
      if (isNotFound(e)) throw new ApiError(422, "CredentialNotFound", `Credential secret ${credNs}/${credName} not found`);
      throw new ApiError(502, "CredentialUnavailable", `The console cannot read credential secret ${credNs}/${credName}`);
    }
    let caBundle: string | undefined;
    const tls = ctx.spec.endpoint.tls;
    if (tls.mode === "Secure" && tls.caBundleRef?.name) {
      try {
        const cm = await this.sa.get<{ data?: Record<string, string> }>(R.configmaps, ns, tls.caBundleRef.name);
        caBundle = cm.data?.["ca.crt"];
      } catch {
        throw new ApiError(422, "CABundleNotFound", `CA bundle ConfigMap ${ns}/${tls.caBundleRef.name} not found`);
      }
    }
    return {
      address: ctx.spec.endpoint.address,
      port: ctx.spec.endpoint.port ?? 9440,
      insecure: tls.mode === "Insecure",
      caBundle,
      username: decode(secret.data?.username),
      password: decode(secret.data?.password),
      apiKey: decode(secret.data?.apiKey),
    };
  }

  async catalog(user: KubeClient, ns: string, contextName: string, kind: CatalogKind, refresh = false): Promise<CatalogResponse> {
    if (!this.cfg.PRISM_PROXY_ENABLED) return { items: [], available: false, message: "The Prism Central catalog is disabled" };
    // Authorization: the user must be allowed to read the context.
    const ctx = await user.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, contextName);
    const key = `${ns}/${contextName}/${ctx.metadata.resourceVersion}/${kind}`;
    const hit = this.cache.get(key);
    if (!refresh && hit && hit.expires > Date.now()) return hit.value;
    let value: CatalogResponse;
    try {
      const client = new PrismClient(await this.credentialsFor(ctx), this.cfg.PRISM_REQUEST_TIMEOUT_MS);
      value = { items: (await client.catalog(kind)).sort((a, b) => a.name.localeCompare(b.name)), available: true };
      this.cache.set(key, { value, expires: Date.now() + this.cfg.PRISM_CACHE_TTL_SECONDS * 1000 });
    } catch (e) {
      const message = e instanceof PrismError || e instanceof ApiError ? e.message : String(e);
      log.warn("Prism catalog unavailable", { ns, context: contextName, kind, error: message });
      value = { items: [], available: false, message };
    }
    return value;
  }

  async test(creds: PrismCredentials): Promise<TestConnectionResult> {
    const started = Date.now();
    try {
      const version = await new PrismClient(creds, this.cfg.PRISM_REQUEST_TIMEOUT_MS).version();
      return { ok: true, message: "Connection successful", pcVersion: version, latencyMs: Date.now() - started };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started };
    }
  }

  async testContext(user: KubeClient, ns: string, name: string): Promise<TestConnectionResult> {
    const ctx = await user.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, name);
    try {
      return await this.test(await this.credentialsFor(ctx));
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

export type { Identity };
