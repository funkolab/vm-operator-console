import {
  type CatalogKind,
  type CatalogResponse,
  isSupportedPcVersion,
  type NutanixPrismContext,
  type PrismAccountRequestSchema,
  type Secret,
  type TestConnectionResult,
  unsupportedPcVersionMessage,
} from "@console/shared";
import type { z } from "zod";
import type { Config } from "../config";
import { ApiError } from "../errors";
import { type Identity, type KubeClient, R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { log } from "../log";
import { PrismClient, type PrismCredentials, PrismError } from "./client";

const decode = (s?: string) => (s ? Buffer.from(s, "base64").toString("utf8") : undefined);

type PrismAccountInput = z.output<typeof PrismAccountRequestSchema>;

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
      if (!isSupportedPcVersion(version))
        return { ok: false, message: unsupportedPcVersionMessage(version), pcVersion: version, latencyMs: Date.now() - started };
      return { ok: true, message: "Connection successful", pcVersion: version, latencyMs: Date.now() - started };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.warn("Prism Central connection test failed", { address: creds.address, port: creds.port, error: message });
      return { ok: false, message, latencyMs: Date.now() - started };
    }
  }

  /**
   * Refuses a new account whose Prism Central is unreachable or older than
   * MIN_PC_VERSION. An existing Secret / CA ConfigMap is read with the user's
   * identity, so this never reveals objects the user cannot read.
   */
  async assertSupported(user: KubeClient, ns: string, req: PrismAccountInput): Promise<string | undefined> {
    let creds: Pick<PrismCredentials, "username" | "password" | "apiKey">;
    if (req.credential.mode === "existing") {
      const credNs = req.credential.secretNamespace || ns;
      let secret: Secret;
      try {
        secret = await user.get<Secret>(R.secrets, credNs, req.credential.secretName);
      } catch (e) {
        if (isNotFound(e)) throw new ApiError(422, "CredentialNotFound", `Credential secret ${credNs}/${req.credential.secretName} not found`);
        throw e;
      }
      creds = { username: decode(secret.data?.username), password: decode(secret.data?.password), apiKey: decode(secret.data?.apiKey) };
    } else {
      creds = req.credential.mode === "basic" ? { username: req.credential.username, password: req.credential.password } : { apiKey: req.credential.apiKey };
    }
    let caBundle = req.caBundle;
    if (req.tlsMode === "Secure" && !caBundle && req.caBundleRef) {
      try {
        caBundle = (await user.get<{ data?: Record<string, string> }>(R.configmaps, ns, req.caBundleRef)).data?.["ca.crt"];
      } catch (e) {
        if (isNotFound(e)) throw new ApiError(422, "CABundleNotFound", `CA bundle ConfigMap ${ns}/${req.caBundleRef} not found`);
        throw e;
      }
    }
    let version: string | undefined;
    try {
      version = await new PrismClient(
        { address: req.address, port: req.port, insecure: req.tlsMode === "Insecure", caBundle, ...creds },
        this.cfg.PRISM_REQUEST_TIMEOUT_MS,
      ).version();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new ApiError(422, "PrismCentralUnreachable", `Cannot verify the Prism Central version: ${message}`);
    }
    if (!isSupportedPcVersion(version)) {
      log.warn("Refused unsupported Prism Central", { ns, name: req.name, address: req.address, version });
      throw new ApiError(422, "PrismCentralUnsupported", unsupportedPcVersionMessage(version));
    }
    return version;
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
