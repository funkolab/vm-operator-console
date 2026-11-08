import {
  type ConfigMap,
  expandNamePattern,
  type InstantiateResult,
  instantiateTemplate,
  isValidVMName,
  Labels,
  LabelValues,
  MAX_INSTANCES,
  TemplateFormatError,
  templateConfigMapName,
  templateFromConfigMap,
  templateFromVM,
  templateToConfigMap,
  type ValidationIssue,
  type VirtualMachine,
  type VMTemplate,
  VMTemplateSchema,
  validateParameterValues,
  validateTemplateVM,
  validateVirtualMachine,
  zodIssues,
} from "@console/shared";
import { ApiError, toErrorBody, validationError } from "../errors";
import { type KubeClient, R } from "../k8s/client";
import { isNotFound } from "../k8s/errors";
import { log } from "../log";

const TEMPLATE_SELECTOR = `${Labels.type}=${LabelValues.vmTemplate}`;

export interface TemplateListItem extends VMTemplate {
  invalid?: string;
}

function prefixIssues(issues: ValidationIssue[], prefix: string): ValidationIssue[] {
  return issues.map((i) => ({ ...i, path: `${prefix}${i.path}` }));
}

/**
 * VM templates stored as labelled ConfigMaps holding a VirtualMachine manifest
 * and parameter definitions. No CRD is required; access is governed by the
 * user's RBAC on ConfigMaps (all calls are impersonated).
 */
export class TemplateService {
  async list(k: KubeClient, ns: string | undefined, withUsage = true): Promise<TemplateListItem[]> {
    const cms = await k.listAll<ConfigMap>(R.configmaps, ns, { labelSelector: TEMPLATE_SELECTOR });
    const usage = new Map<string, number>();
    if (withUsage) {
      try {
        const vms = await k.listAll<VirtualMachine>(R.virtualmachines, ns, { labelSelector: Labels.template });
        for (const vm of vms.items) {
          const key = `${vm.metadata.namespace}/${vm.metadata.labels?.[Labels.template]}`;
          usage.set(key, (usage.get(key) ?? 0) + 1);
        }
      } catch {
        /* usage is best effort */
      }
    }
    return cms.items
      .map((cm): TemplateListItem => {
        try {
          const t = templateFromConfigMap(cm);
          return { ...t, usageCount: usage.get(`${t.namespace}/${t.name}`) ?? 0 };
        } catch (e) {
          return {
            name: (cm.metadata.name ?? "").replace(/^vmt-/, ""),
            namespace: cm.metadata.namespace ?? "",
            displayName: cm.metadata.name ?? "",
            tags: [],
            osType: "Other",
            parameters: [],
            vm: { apiVersion: "vmm.v4.nutanix.com/v1alpha1", kind: "VirtualMachine", metadata: {}, spec: {} as VirtualMachine["spec"] },
            resourceVersion: cm.metadata.resourceVersion,
            invalid: e instanceof TemplateFormatError ? e.message : String(e),
          };
        }
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async getConfigMap(k: KubeClient, ns: string, name: string): Promise<ConfigMap> {
    const cm = await k.get<ConfigMap>(R.configmaps, ns, templateConfigMapName(name));
    if (cm.metadata.labels?.[Labels.type] !== LabelValues.vmTemplate) throw new ApiError(404, "NotFound", `Template "${name}" not found`);
    return cm;
  }

  async get(k: KubeClient, ns: string, name: string): Promise<VMTemplate> {
    const cm = await this.getConfigMap(k, ns, name);
    try {
      return templateFromConfigMap(cm);
    } catch (e) {
      throw new ApiError(422, "InvalidTemplate", (e as Error).message);
    }
  }

  /**
   * Validates a template: schema, parameters, the VM manifest with the shared
   * CEL/VAP rules, and finally a server-side dry-run create of a sample VM so
   * the API server applies the real CRD schema and admission policies.
   */
  async validate(k: KubeClient, input: unknown, ns: string): Promise<VMTemplate> {
    const parsed = VMTemplateSchema.safeParse({ ...(input as object), namespace: ns });
    if (!parsed.success) throw validationError(zodIssues(parsed.error));
    const t = parsed.data;
    const issues = validateTemplateVM(t);
    if (issues.length) throw validationError(issues);
    const sample = this.sampleValues(t);
    const vm = instantiateTemplate(t, { name: `vmt-dryrun-${Date.now().toString(36)}`, namespace: ns, values: sample });
    const renderIssues = validateVirtualMachine(vm, { mode: "create" });
    if (renderIssues.length) throw validationError(prefixIssues(renderIssues, "/vm"), "The template does not render a valid VM");
    try {
      await k.create(R.virtualmachines, ns, vm, { dryRun: true });
    } catch (e) {
      const { status, body } = toErrorBody(e);
      if (status === 403) return t; // user may author templates without permission to create VMs
      throw new ApiError(422, "DryRunFailed", `The API server rejected the rendered VM: ${body.error.message}`, prefixIssues(body.error.details ?? [], "/vm"));
    }
    return t;
  }

  /** Placeholder values used to dry-run a template whose required parameters have no default. */
  private sampleValues(t: VMTemplate): Record<string, unknown> {
    const v: Record<string, unknown> = {};
    for (const p of t.parameters) {
      if (p.default !== undefined || !p.required) continue;
      switch (p.type) {
        case "string":
          v[p.name] = "sample";
          break;
        case "integer":
          v[p.name] = Number(p.min ?? 1);
          break;
        case "quantity":
          v[p.name] = String(p.min ?? "1Gi");
          break;
        case "boolean":
          v[p.name] = false;
          break;
        case "enum":
          v[p.name] = p.options?.[0];
          break;
        default:
          v[p.name] = { type: "name", name: "sample" };
      }
    }
    return v;
  }

  async create(k: KubeClient, ns: string, input: unknown, user?: string, dryRun = false): Promise<VMTemplate> {
    const t = await this.validate(k, input, ns);
    const cm = templateToConfigMap(t, { user });
    const created = await k.create<ConfigMap>(R.configmaps, ns, cm, { dryRun });
    log.info("Created VM template", { ns, name: t.name, user });
    return templateFromConfigMap(created);
  }

  async update(k: KubeClient, ns: string, name: string, input: unknown, user?: string): Promise<VMTemplate> {
    const existing = await this.getConfigMap(k, ns, name);
    const t = await this.validate(k, { ...(input as object), name }, ns);
    const cm = templateToConfigMap(t, { user, existing });
    const updated = await k.replace<ConfigMap>(R.configmaps, ns, templateConfigMapName(name), cm);
    return templateFromConfigMap(updated);
  }

  async delete(k: KubeClient, ns: string, name: string) {
    await this.getConfigMap(k, ns, name);
    await k.delete(R.configmaps, ns, templateConfigMapName(name));
  }

  async duplicate(k: KubeClient, ns: string, name: string, req: { name: string; displayName?: string; namespace?: string }, user?: string) {
    const t = await this.get(k, ns, name);
    const target = req.namespace ?? ns;
    return this.create(k, target, { ...t, name: req.name, namespace: target, displayName: req.displayName ?? `${t.displayName} (copy)` }, user);
  }

  async saveFromVM(
    k: KubeClient,
    ns: string,
    vmName: string,
    req: { name: string; displayName: string; description?: string; tags: string[]; osType?: VMTemplate["osType"]; parameters?: unknown[] },
    user?: string,
  ) {
    const vm = await k.get<VirtualMachine>(R.virtualmachines, ns, vmName);
    const t = templateFromVM(vm, { ...req, namespace: ns, parameters: (req.parameters ?? []) as VMTemplate["parameters"] });
    return this.create(k, ns, t, user);
  }

  async render(k: KubeClient, ns: string, name: string, values: Record<string, unknown>, vmName = "preview") {
    const t = await this.get(k, ns, name);
    const errors = validateParameterValues(t, values);
    const vm = instantiateTemplate(t, { name: vmName, namespace: ns, values });
    return { vm, parameterErrors: errors, issues: errors.length ? [] : validateVirtualMachine(vm, { mode: "create" }) };
  }

  async instantiate(
    k: KubeClient,
    ns: string,
    name: string,
    req: {
      namePattern: string;
      count: number;
      values: Record<string, unknown>;
      overrideSpec?: Record<string, unknown>;
      labels?: Record<string, string>;
      powerState?: "On" | "Off";
      dryRun?: boolean;
    },
    user?: string,
  ): Promise<InstantiateResult> {
    const t = await this.get(k, ns, name);
    if (!req.overrideSpec) {
      const errors = validateParameterValues(t, req.values);
      if (errors.length) throw validationError(errors.map((e) => ({ path: `/values/${e.parameter}`, message: e.message })));
    }
    const names = expandNamePattern(req.namePattern, req.count);
    if (names.length > MAX_INSTANCES) throw new ApiError(400, "TooManyInstances", `At most ${MAX_INSTANCES} VMs can be created at once`);
    const bad = names.filter((n) => !isValidVMName(n));
    if (bad.length) throw validationError([{ path: "/namePattern", message: `Invalid VM name(s): ${bad.slice(0, 3).join(", ")}` }]);
    const results: InstantiateResult["results"] = [];
    for (const vmName of names) {
      const vm = instantiateTemplate(t, {
        name: vmName,
        namespace: ns,
        values: req.values,
        overrideSpec: req.overrideSpec as VirtualMachine["spec"] | undefined,
        extraLabels: req.labels,
        powerState: req.powerState,
      });
      if (!vm.spec.displayName || (names.length > 1 && vm.spec.displayName === t.vm.spec.displayName)) vm.spec.displayName = vmName;
      if (user) vm.metadata.annotations = { ...vm.metadata.annotations, "console.nutanix.com/created-by": user };
      const issues = validateVirtualMachine(vm, { mode: "create" });
      if (issues.length) {
        results.push({ name: vmName, ok: false, error: "Validation failed", details: issues });
        continue;
      }
      try {
        await k.create(R.virtualmachines, ns, vm, { dryRun: req.dryRun });
        results.push({ name: vmName, ok: true });
      } catch (e) {
        const { body } = toErrorBody(e);
        results.push({ name: vmName, ok: false, error: body.error.message, details: body.error.details });
      }
    }
    log.info("Instantiated VM template", { ns, template: name, user, created: results.filter((r) => r.ok).length, dryRun: !!req.dryRun });
    return { results };
  }

  async vmsFromTemplate(k: KubeClient, ns: string, name: string): Promise<VirtualMachine[]> {
    try {
      const res = await k.listAll<VirtualMachine>(R.virtualmachines, ns, { labelSelector: `${Labels.template}=${name}` });
      return res.items;
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  }
}
