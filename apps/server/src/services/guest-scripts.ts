import {
  Annotations,
  GUEST_SCRIPT_KEYS,
  type GuestScript,
  type GuestScriptCreate,
  type GuestScriptSummary,
  type GuestScriptType,
  type GuestScriptUpdate,
  type GuestScriptUsage,
  Labels,
  LabelValues,
  lintGuestScript,
  type Secret,
  type VirtualMachine,
  type VMTemplate,
} from "@console/shared";
import { ApiError, validationError } from "../errors";
import { type KubeClient, R } from "../k8s/client";
import { isConflict, isForbidden, isNotFound } from "../k8s/errors";
import type { TemplateService } from "./templates";

const SELECTOR = `${Labels.type}=${LabelValues.guestCustomization}`;

const isScript = (s: Secret) => s.metadata.labels?.[Labels.type] === LabelValues.guestCustomization;
const typeOf = (s: Secret): GuestScriptType => (s.data?.[GUEST_SCRIPT_KEYS.Sysprep] !== undefined ? "Sysprep" : "CloudInit");
const payload = (s: Secret) => s.data?.[GUEST_SCRIPT_KEYS[typeOf(s)]] ?? "";
const decodedSize = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

function lastUpdate(s: Secret): string | undefined {
  return (
    (s.metadata.managedFields as { time?: string }[] | undefined)
      ?.map((f) => f.time)
      .filter(Boolean)
      .sort()
      .at(-1) ??
    s.metadata.creationTimestamp ??
    undefined
  );
}

function summary(s: Secret, usage: GuestScriptSummary["usage"]): GuestScriptSummary {
  const ann = s.metadata.annotations ?? {};
  return {
    name: s.metadata.name as string,
    namespace: s.metadata.namespace as string,
    type: typeOf(s),
    description: ann[Annotations.description] || undefined,
    sizeBytes: decodedSize(payload(s)),
    createdBy: ann[Annotations.createdBy],
    updatedBy: ann[Annotations.updatedBy],
    updatedAt: lastUpdate(s),
    usage,
  };
}

const refOf = (spec: VirtualMachine["spec"] | undefined) => spec?.guestCustomization?.secretRef?.name;

/**
 * Cloud-init / Sysprep scripts kept in Secrets labelled
 * console.nutanix.com/type=guest-customization. All calls are impersonated, so
 * the user's RBAC on Secrets applies; content is only returned when the user
 * may `get` the Secret.
 */
export class GuestScriptService {
  constructor(private readonly templates: TemplateService) {}

  private async references(k: KubeClient, ns: string) {
    const [vms, templates] = await Promise.all([
      k.listAll<VirtualMachine>(R.virtualmachines, ns).catch(() => ({ items: [] as VirtualMachine[] })),
      this.templates.list(k, ns, false).catch(() => [] as VMTemplate[]),
    ]);
    return { vms: vms.items, templates };
  }

  private usageOf(name: string, refs: Awaited<ReturnType<GuestScriptService["references"]>>): GuestScriptUsage {
    return {
      vms: refs.vms.filter((vm) => refOf(vm.spec) === name).map((vm) => ({ name: vm.metadata.name as string, provisioned: !!vm.status?.externalID })),
      templates: refs.templates.filter((t) => refOf(t.vm.spec as VirtualMachine["spec"]) === name).map((t) => ({ name: t.name, displayName: t.displayName })),
    };
  }

  async list(k: KubeClient, ns: string): Promise<GuestScriptSummary[]> {
    const [secrets, refs] = await Promise.all([k.listAll<Secret>(R.secrets, ns, { labelSelector: SELECTOR }), this.references(k, ns)]);
    return secrets.items
      .map((s) => {
        const u = this.usageOf(s.metadata.name as string, refs);
        return summary(s, { vms: u.vms.length, templates: u.templates.length });
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async load(k: KubeClient, ns: string, name: string): Promise<Secret> {
    const s = await k.get<Secret>(R.secrets, ns, name);
    if (!isScript(s)) throw new ApiError(404, "NotFound", `Secret "${name}" is not a guest customization script managed by the console`);
    return s;
  }

  async get(k: KubeClient, ns: string, name: string): Promise<GuestScript> {
    let secret: Secret | undefined;
    try {
      secret = await this.load(k, ns, name);
    } catch (e) {
      // Without `get`, fall back to the listed metadata (content stays hidden).
      if (!isForbidden(e)) throw e;
      const listed = await k.listAll<Secret>(R.secrets, ns, { labelSelector: SELECTOR });
      const found = listed.items.find((s) => s.metadata.name === name);
      if (!found) throw e;
      const { content: _hidden, ...rest } = await this.view(k, ns, found);
      return rest;
    }
    return this.view(k, ns, secret);
  }

  private async view(k: KubeClient, ns: string, s: Secret): Promise<GuestScript> {
    const usage = this.usageOf(s.metadata.name as string, await this.references(k, ns));
    const { usage: _counts, ...base } = summary(s, { vms: usage.vms.length, templates: usage.templates.length });
    return { ...base, resourceVersion: s.metadata.resourceVersion, content: Buffer.from(payload(s), "base64").toString("utf8"), usage };
  }

  private check(type: GuestScriptType, content: string) {
    const errors = lintGuestScript(type, content).filter((i) => i.severity === "error");
    if (errors.length) throw validationError(errors.map((e) => ({ path: "/content", message: e.line ? `Line ${e.line}: ${e.message}` : e.message })));
  }

  private secret(ns: string, name: string, req: GuestScriptUpdate, annotations: Record<string, string>): Secret {
    return {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name, namespace: ns, labels: { [Labels.managed]: "true", [Labels.type]: LabelValues.guestCustomization }, annotations },
      type: "Opaque",
      data: { [GUEST_SCRIPT_KEYS[req.type]]: Buffer.from(req.content, "utf8").toString("base64") },
    };
  }

  /** Creates a new script; never overwrites an existing Secret (409). */
  async create(k: KubeClient, ns: string, req: GuestScriptCreate, user?: string): Promise<GuestScript> {
    this.check(req.type, req.content);
    const ann: Record<string, string> = {};
    if (req.description) ann[Annotations.description] = req.description;
    if (user) Object.assign(ann, { [Annotations.createdBy]: user, [Annotations.updatedBy]: user });
    try {
      await k.create(R.secrets, ns, this.secret(ns, req.name, req, ann));
    } catch (e) {
      if (isConflict(e)) throw new ApiError(409, "AlreadyExists", `A Secret named "${req.name}" already exists in ${ns}; choose another name`);
      throw e;
    }
    return this.get(k, ns, req.name);
  }

  async update(k: KubeClient, ns: string, name: string, req: GuestScriptUpdate, user?: string): Promise<GuestScript> {
    const cur = await this.load(k, ns, name);
    // VMs reference the script with an engine type: switching it would break them.
    if (typeOf(cur) !== req.type) throw validationError([{ path: "/type", message: "The engine of an existing script cannot be changed" }]);
    this.check(req.type, req.content);
    const ann = { ...(cur.metadata.annotations ?? {}) };
    if (req.description) ann[Annotations.description] = req.description;
    else delete ann[Annotations.description];
    if (user) ann[Annotations.updatedBy] = user;
    const next = this.secret(ns, name, req, ann);
    next.metadata.labels = { ...(cur.metadata.labels ?? {}), ...next.metadata.labels };
    next.metadata.resourceVersion = req.resourceVersion ?? cur.metadata.resourceVersion;
    try {
      await k.replace(R.secrets, ns, name, next);
    } catch (e) {
      if (isConflict(e)) throw new ApiError(409, "Conflict", "The script was changed by someone else since you opened it; reload to see the latest version");
      throw e;
    }
    return this.get(k, ns, name);
  }

  async delete(k: KubeClient, ns: string, name: string) {
    const cur = await this.load(k, ns, name);
    try {
      await k.delete(R.secrets, ns, name, { resourceVersion: cur.metadata.resourceVersion });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
}
