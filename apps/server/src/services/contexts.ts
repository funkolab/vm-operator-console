import {
  Annotations,
  ApiVersions,
  type CredentialInfo,
  Labels,
  LabelValues,
  type NutanixPrismContext,
  type PrismAccountRequest,
  PrismAccountRequestSchema,
  type Secret,
  stripManagedFields,
  type VirtualMachine,
  zodIssues,
} from "@console/shared";
import { z } from "zod";
import { ApiError, validationError } from "../errors";
import { type KubeClient, R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { log } from "../log";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s?: string) => (s ? Buffer.from(s, "base64").toString("utf8") : undefined);

export interface ContextView extends NutanixPrismContext {
  credentialInfo?: CredentialInfo;
  vmCount?: number;
}

export const UpdateAccountSchema = z.object({
  address: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tlsMode: z.enum(["Secure", "Insecure"]),
  caBundle: z.string().optional(),
  resourceVersion: z.string().optional(),
});

function credentialSecret(
  name: string,
  ns: string,
  req: { mode: "basic"; username: string; password: string } | { mode: "apiKey"; apiKey: string },
  user?: string,
): Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name,
      namespace: ns,
      labels: { [Labels.managed]: "true", [Labels.type]: LabelValues.prismCredential },
      annotations: user ? { [Annotations.updatedBy]: user } : undefined,
    },
    type: req.mode === "basic" ? "kubernetes.io/basic-auth" : "Opaque",
    data: req.mode === "basic" ? { username: b64(req.username), password: b64(req.password) } : { apiKey: b64(req.apiKey) },
  };
}

/**
 * Prism Central accounts: a NutanixPrismContext plus its credential Secret and
 * optional CA bundle ConfigMap, created and maintained with the user's
 * impersonated identity. Secret values are never returned.
 */
export class ContextService {
  async list(k: KubeClient, ns?: string): Promise<ContextView[]> {
    const [ctxs, vms] = await Promise.all([
      k.listAll<NutanixPrismContext>(R.nutanixprismcontexts, ns),
      k.listAll<VirtualMachine>(R.virtualmachines, ns).catch(() => ({ items: [] as VirtualMachine[] })),
    ]);
    const usage = new Map<string, number>();
    for (const vm of vms.items) {
      const c = vm.status?.resolvedContextRef?.name ?? vm.spec.context?.name;
      if (c) usage.set(`${vm.metadata.namespace}/${c}`, (usage.get(`${vm.metadata.namespace}/${c}`) ?? 0) + 1);
    }
    return ctxs.items.map((c) => ({ ...stripManagedFields(c), vmCount: usage.get(`${c.metadata.namespace}/${c.metadata.name}`) ?? 0 }));
  }

  async get(k: KubeClient, ns: string, name: string): Promise<ContextView> {
    const ctx = stripManagedFields(await k.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, name));
    return { ...ctx, credentialInfo: await this.credentialInfo(k, ctx) };
  }

  async credentialInfo(k: KubeClient, ctx: NutanixPrismContext): Promise<CredentialInfo> {
    const secretNamespace = ctx.spec.credential.namespace || (ctx.metadata.namespace as string);
    const secretName = ctx.spec.credential.name ?? "";
    try {
      const s = await k.get<Secret>(R.secrets, secretNamespace, secretName);
      return {
        secretName,
        secretNamespace,
        exists: true,
        mode: s.data?.apiKey ? "apiKey" : "basic",
        username: unb64(s.data?.username),
        managed: s.metadata.labels?.[Labels.managed] === "true",
        updatedAt:
          (s.metadata.managedFields as { time?: string }[] | undefined)
            ?.map((f) => f.time)
            .filter(Boolean)
            .sort()
            .at(-1) ??
          s.metadata.creationTimestamp ??
          undefined,
      };
    } catch (e) {
      return { secretName, secretNamespace, exists: !isNotFound(e) && false, managed: false };
    }
  }

  async usedBy(k: KubeClient, ns: string, name: string): Promise<string[]> {
    const vms = await k.listAll<VirtualMachine>(R.virtualmachines, ns);
    return vms.items.filter((vm) => (vm.status?.resolvedContextRef?.name ?? vm.spec.context?.name) === name).map((vm) => vm.metadata.name as string);
  }

  /** Creates the Secret, CA ConfigMap and context; rolls back created objects on failure. */
  async createAccount(k: KubeClient, ns: string, input: PrismAccountRequest, user?: string): Promise<ContextView> {
    const parsed = PrismAccountRequestSchema.safeParse(input);
    if (!parsed.success) throw validationError(zodIssues(parsed.error));
    const req = parsed.data;
    const created: { rt: typeof R.secrets | typeof R.configmaps; name: string }[] = [];
    let secretRef: { name: string; namespace?: string };
    let caRef: string | undefined = req.caBundleRef;
    try {
      if (req.credential.mode === "existing") {
        secretRef = { name: req.credential.secretName, namespace: req.credential.secretNamespace || undefined };
      } else {
        const secretName = `${req.name}-credentials`;
        await k.create(R.secrets, ns, credentialSecret(secretName, ns, req.credential, user));
        created.push({ rt: R.secrets, name: secretName });
        secretRef = { name: secretName };
      }
      if (req.tlsMode === "Secure" && req.caBundle) {
        caRef = `${req.name}-ca`;
        await k.create(R.configmaps, ns, {
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: caRef, namespace: ns, labels: { [Labels.managed]: "true", [Labels.type]: LabelValues.prismCABundle } },
          data: { "ca.crt": req.caBundle },
        });
        created.push({ rt: R.configmaps, name: caRef });
      }
      const ctx: NutanixPrismContext = {
        apiVersion: ApiVersions.prism,
        kind: "NutanixPrismContext",
        metadata: { name: req.name, namespace: ns, annotations: user ? { [Annotations.createdBy]: user } : undefined },
        spec: {
          endpoint: {
            address: req.address,
            port: req.port,
            tls: { mode: req.tlsMode, ...(req.tlsMode === "Secure" && caRef ? { caBundleRef: { name: caRef } } : {}) },
          },
          credential: secretRef,
          ...(req.project
            ? { project: req.project.type === "extId" ? { type: "extId", extId: req.project.extId } : { type: "name", name: req.project.name } }
            : {}),
        },
      };
      const out = await k.create<NutanixPrismContext>(R.nutanixprismcontexts, ns, ctx);
      // Garbage-collect managed Secret/ConfigMap with the context.
      const ownerRef = { apiVersion: ApiVersions.prism, kind: "NutanixPrismContext", name: req.name, uid: out.metadata.uid as string };
      for (const c of created)
        await k
          .patch(c.rt, ns, c.name, { metadata: { ownerReferences: [ownerRef] } }, "merge")
          .catch((e) => log.warn("Could not set owner reference", { name: c.name, error: String(e) }));
      log.info("Created Prism Central account", { ns, name: req.name, user });
      return stripManagedFields(out);
    } catch (e) {
      for (const c of created.reverse()) await k.delete(c.rt, ns, c.name).catch(() => {});
      throw e;
    }
  }

  async updateEndpoint(k: KubeClient, ns: string, name: string, input: z.infer<typeof UpdateAccountSchema>, user?: string) {
    const ctx = await k.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, name);
    let caRef = ctx.spec.endpoint.tls.caBundleRef?.name;
    if (input.tlsMode === "Secure" && input.caBundle) {
      caRef ??= `${name}-ca`;
      const cm = {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: {
          name: caRef,
          namespace: ns,
          labels: { [Labels.managed]: "true", [Labels.type]: LabelValues.prismCABundle },
          ownerReferences: [{ apiVersion: ApiVersions.prism, kind: "NutanixPrismContext", name, uid: ctx.metadata.uid as string }],
        },
        data: { "ca.crt": input.caBundle },
      };
      try {
        await k.get(R.configmaps, ns, caRef);
        await k.patch(R.configmaps, ns, caRef, { data: cm.data }, "merge");
      } catch (e) {
        if (!isNotFound(e)) throw e;
        await k.create(R.configmaps, ns, cm);
      }
    }
    if (input.tlsMode === "Secure" && !caRef) throw validationError([{ path: "/caBundle", message: "A CA bundle is required in Secure mode" }]);
    return stripManagedFields(
      await k.patch<NutanixPrismContext>(
        R.nutanixprismcontexts,
        ns,
        name,
        {
          metadata: { resourceVersion: input.resourceVersion, annotations: user ? { [Annotations.updatedBy]: user } : undefined },
          spec: {
            endpoint: {
              address: input.address,
              port: input.port,
              tls: { mode: input.tlsMode, caBundleRef: input.tlsMode === "Secure" ? { name: caRef } : null },
            },
          },
        },
        "merge",
      ),
    );
  }

  /** Rotates credentials by rewriting the referenced Secret (created if absent). */
  async rotateCredential(
    k: KubeClient,
    ns: string,
    name: string,
    cred: { mode: "basic"; username: string; password: string } | { mode: "apiKey"; apiKey: string },
    user?: string,
  ) {
    const ctx = await k.get<NutanixPrismContext>(R.nutanixprismcontexts, ns, name);
    const secretNs = ctx.spec.credential.namespace || ns;
    const secretName = ctx.spec.credential.name;
    if (!secretName) throw new ApiError(422, "CredentialMissing", "The context has no credential reference");
    const desired = credentialSecret(secretName, secretNs, cred, user);
    try {
      const existing = await k.get<Secret>(R.secrets, secretNs, secretName);
      await k.replace(R.secrets, secretNs, secretName, {
        ...desired,
        metadata: {
          ...existing.metadata,
          labels: { ...existing.metadata.labels, ...desired.metadata.labels },
          annotations: { ...existing.metadata.annotations, ...desired.metadata.annotations },
          managedFields: undefined,
        },
        type: existing.type === desired.type ? existing.type : existing.type,
      });
    } catch (e) {
      if (!isNotFound(e)) throw e;
      await k.create(R.secrets, secretNs, desired);
    }
    log.info("Rotated Prism Central credentials", { ns, name, user });
  }

  async delete(k: KubeClient, ns: string, name: string, force = false) {
    if (!force) {
      const used = await this.usedBy(k, ns, name);
      if (used.length)
        throw new ApiError(409, "ContextInUse", `This context is used by ${used.length} VM(s): ${used.slice(0, 5).join(", ")}${used.length > 5 ? "…" : ""}`);
    }
    await k.delete(R.nutanixprismcontexts, ns, name, { propagationPolicy: "Background" });
  }

  async listCredentialSecrets(k: KubeClient, ns: string) {
    const res = await k.listAll<Secret>(R.secrets, ns, { labelSelector: `${Labels.type}=${LabelValues.prismCredential}` });
    return res.items.map((s) => ({ name: s.metadata.name, mode: s.data?.apiKey ? "apiKey" : "basic", username: unb64(s.data?.username) }));
  }
}
