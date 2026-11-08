import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { Annotations, ApiVersions, DNS1123_LABEL, Labels, LabelValues, NUTANIX_NAME_RE, UUID_RE } from "./constants";
import type { VirtualMachine } from "./crd";
import type { ConfigMap } from "./k8s";
import { getPointer, parsePointer, setPointer } from "./pointer";
import { isQuantity, parseQuantity } from "./quantity";
import { type ValidationIssue, validateVirtualMachine } from "./rules";
import { cleanVMForCopy } from "./vm";

export const TEMPLATE_FORMAT_VERSION = "1";
export const TEMPLATE_CONFIGMAP_PREFIX = "vmt-";
export const TEMPLATE_KEYS = {
  formatVersion: "formatVersion",
  vm: "virtualmachine.yaml",
  parameters: "parameters.yaml",
} as const;

export const PARAMETER_TYPES = ["string", "integer", "quantity", "boolean", "enum", "clusterRef", "subnetRef", "imageRef", "storageContainerRef"] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];
export const REF_PARAMETER_TYPES: ParameterType[] = ["clusterRef", "subnetRef", "imageRef", "storageContainerRef"];

const ResourceRefValueSchema = z.looseObject({
  type: z.enum(["extId", "name"]),
  extId: z.string().regex(UUID_RE, "Must be a UUID").optional(),
  name: z.string().min(1).max(256).regex(NUTANIX_NAME_RE, "Invalid Nutanix resource name").optional(),
});

export const TemplateParameterSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, digits and underscores, starting with a letter")
      .max(63),
    label: z.string().max(128).optional(),
    description: z.string().max(1024).optional(),
    /** JSON pointer into the VirtualMachine manifest, e.g. /spec/compute/memorySize */
    path: z.string().startsWith("/", "Must be a JSON pointer starting with /"),
    type: z.enum(PARAMETER_TYPES),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    options: z.array(z.string()).optional(),
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
    pattern: z.string().optional(),
  })
  .superRefine((p, ctx) => {
    if (p.type === "enum" && !p.options?.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Enum parameters need at least one option" });
    if (p.path.startsWith("/metadata/name") || p.path.startsWith("/metadata/namespace") || p.path === "/spec/biosUUID")
      ctx.addIssue({ code: "custom", path: ["path"], message: "This field cannot be parameterized" });
    if (p.default !== undefined) {
      const err = checkParameterValue(p as TemplateParameter, p.default);
      if (err) ctx.addIssue({ code: "custom", path: ["default"], message: `Default: ${err}` });
    }
  });
export type TemplateParameter = z.infer<typeof TemplateParameterSchema>;

export const TemplateParametersSchema = z.array(TemplateParameterSchema).superRefine((params, ctx) => {
  const names = new Set<string>();
  const paths = new Set<string>();
  params.forEach((p, i) => {
    if (names.has(p.name)) ctx.addIssue({ code: "custom", path: [i, "name"], message: `Duplicate parameter "${p.name}"` });
    if (paths.has(p.path)) ctx.addIssue({ code: "custom", path: [i, "path"], message: `Path ${p.path} is already parameterized` });
    names.add(p.name);
    paths.add(p.path);
  });
});

/** The VirtualMachine manifest stored in a template: no identity, no status. */
export const TemplateVMSchema = z.looseObject({
  apiVersion: z.literal(ApiVersions.vmm).default(ApiVersions.vmm),
  kind: z.literal("VirtualMachine").default("VirtualMachine"),
  metadata: z
    .looseObject({
      labels: z.record(z.string(), z.string()).optional(),
      annotations: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
  // Structural check only: fields bound to required parameters may be empty in
  // the stored manifest. Field-level rules are applied by validateTemplateVM.
  spec: z.custom<VirtualMachine["spec"]>((v) => typeof v === "object" && v !== null && !Array.isArray(v), "spec must be an object"),
});
export type TemplateVM = z.infer<typeof TemplateVMSchema>;

export const TemplateOSTypes = ["Linux", "Windows", "Other"] as const;

/** The template as manipulated by the API and the UI. */
export const VMTemplateSchema = z.object({
  name: z
    .string()
    .max(253)
    .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, "Must be lowercase alphanumeric with dashes"),
  namespace: z.string(),
  displayName: z.string().min(1, "Display name is required").max(128),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(63)).max(32).default([]),
  osType: z.enum(TemplateOSTypes).default("Linux"),
  vm: TemplateVMSchema,
  parameters: TemplateParametersSchema.default([]),
  // read-only metadata
  resourceVersion: z.string().optional(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  usageCount: z.number().optional(),
});
export type VMTemplate = z.infer<typeof VMTemplateSchema>;
export type VMTemplateInput = z.input<typeof VMTemplateSchema>;

export function templateConfigMapName(name: string): string {
  return `${TEMPLATE_CONFIGMAP_PREFIX}${name}`;
}

export function templateNameFromConfigMap(cmName: string): string {
  return cmName.startsWith(TEMPLATE_CONFIGMAP_PREFIX) ? cmName.slice(TEMPLATE_CONFIGMAP_PREFIX.length) : cmName;
}

export class TemplateFormatError extends Error {}

/** Decodes a ConfigMap into a VMTemplate. Throws TemplateFormatError on malformed content. */
export function templateFromConfigMap(cm: ConfigMap): VMTemplate {
  const data = cm.data ?? {};
  const ann = cm.metadata.annotations ?? {};
  const version = data[TEMPLATE_KEYS.formatVersion] ?? TEMPLATE_FORMAT_VERSION;
  if (version !== TEMPLATE_FORMAT_VERSION) throw new TemplateFormatError(`Unsupported template format version "${version}"`);
  let vmRaw: unknown;
  let paramsRaw: unknown;
  try {
    vmRaw = parseYaml(data[TEMPLATE_KEYS.vm] ?? "");
    paramsRaw = parseYaml(data[TEMPLATE_KEYS.parameters] ?? "[]") ?? [];
  } catch (e) {
    throw new TemplateFormatError(`Invalid YAML: ${(e as Error).message}`);
  }
  const vm = TemplateVMSchema.safeParse(vmRaw);
  if (!vm.success) throw new TemplateFormatError(`Invalid ${TEMPLATE_KEYS.vm}: ${vm.error.issues[0]?.message}`);
  const params = TemplateParametersSchema.safeParse(paramsRaw);
  if (!params.success) throw new TemplateFormatError(`Invalid ${TEMPLATE_KEYS.parameters}: ${params.error.issues[0]?.message}`);
  const name = cm.metadata.name ?? "";
  return {
    name: templateNameFromConfigMap(name),
    namespace: cm.metadata.namespace ?? "",
    displayName: ann[Annotations.displayName] || templateNameFromConfigMap(name),
    description: ann[Annotations.description] || undefined,
    tags: (ann[Annotations.tags] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    osType: (TemplateOSTypes as readonly string[]).includes(cm.metadata.labels?.[Labels.os] ?? "")
      ? (cm.metadata.labels?.[Labels.os] as VMTemplate["osType"])
      : "Other",
    vm: vm.data,
    parameters: params.data,
    resourceVersion: cm.metadata.resourceVersion,
    createdAt: cm.metadata.creationTimestamp ?? undefined,
    createdBy: ann[Annotations.createdBy],
    updatedBy: ann[Annotations.updatedBy],
  };
}

/** Encodes a VMTemplate into its ConfigMap representation. */
export function templateToConfigMap(t: VMTemplate, opts: { user?: string; existing?: ConfigMap } = {}): ConfigMap {
  const existingAnn = opts.existing?.metadata.annotations ?? {};
  const annotations: Record<string, string> = {
    ...existingAnn,
    [Annotations.displayName]: t.displayName,
    [Annotations.tags]: t.tags.join(","),
  };
  if (t.description) annotations[Annotations.description] = t.description;
  else delete annotations[Annotations.description];
  if (opts.user) {
    if (!opts.existing) annotations[Annotations.createdBy] = opts.user;
    annotations[Annotations.updatedBy] = opts.user;
  }
  const vm = structuredClone(t.vm) as Record<string, unknown> & TemplateVM;
  const meta = vm.metadata as Record<string, unknown>;
  delete meta.name;
  delete meta.namespace;
  delete meta.generateName;
  delete (vm.spec as Record<string, unknown>).biosUUID;
  delete vm.status;
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      ...(opts.existing ? { resourceVersion: t.resourceVersion ?? opts.existing.metadata.resourceVersion } : {}),
      name: templateConfigMapName(t.name),
      namespace: t.namespace,
      labels: {
        ...(opts.existing?.metadata.labels ?? {}),
        [Labels.type]: LabelValues.vmTemplate,
        [Labels.os]: t.osType,
      },
      annotations,
    },
    data: {
      [TEMPLATE_KEYS.formatVersion]: TEMPLATE_FORMAT_VERSION,
      [TEMPLATE_KEYS.vm]: stringifyYaml(vm, { lineWidth: 0 }),
      [TEMPLATE_KEYS.parameters]: stringifyYaml(t.parameters, { lineWidth: 0 }),
    },
  };
}

/** Validates a single parameter value. Returns an error message or undefined. */
export function checkParameterValue(p: TemplateParameter, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return p.required ? "Value is required" : undefined;
  switch (p.type) {
    case "string":
      if (typeof value !== "string") return "Must be a string";
      if (p.pattern && !new RegExp(p.pattern).test(value)) return `Must match ${p.pattern}`;
      return;
    case "integer": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) return "Must be an integer";
      if (p.min !== undefined && n < Number(p.min)) return `Must be ≥ ${p.min}`;
      if (p.max !== undefined && n > Number(p.max)) return `Must be ≤ ${p.max}`;
      return;
    }
    case "quantity": {
      if (!isQuantity(value)) return "Must be a quantity such as 4Gi";
      const q = parseQuantity(value as string);
      if (q <= 0) return "Must be positive";
      if (p.min !== undefined && q < parseQuantity(p.min)) return `Must be ≥ ${p.min}`;
      if (p.max !== undefined && q > parseQuantity(p.max)) return `Must be ≤ ${p.max}`;
      return;
    }
    case "boolean":
      return typeof value === "boolean" || value === "true" || value === "false" ? undefined : "Must be true or false";
    case "enum":
      return p.options?.includes(String(value)) ? undefined : `Must be one of ${p.options?.join(", ")}`;
    default: {
      const r = ResourceRefValueSchema.safeParse(value);
      if (!r.success) return r.error.issues[0]?.message ?? "Invalid reference";
      if (r.data.type === "extId" && !r.data.extId) return "extId is required";
      if (r.data.type === "name" && !r.data.name) return "Name is required";
      return;
    }
  }
}

function coerce(p: TemplateParameter, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (p.type === "integer") return Number(value);
  if (p.type === "boolean") return value === true || value === "true";
  if (REF_PARAMETER_TYPES.includes(p.type)) {
    const r = value as { type: string; extId?: string; name?: string };
    return r.type === "extId" ? { type: "extId", extId: r.extId } : { type: "name", name: r.name };
  }
  return value;
}

export interface ParameterError {
  parameter: string;
  message: string;
}

/**
 * The value a parameter takes at deploy time: the user's value, else the
 * parameter default, else (for optional parameters) the value already present
 * in the template manifest. Required parameters must be supplied explicitly
 * unless they define a default.
 */
export function effectiveParameterValue(t: Pick<VMTemplate, "vm">, p: TemplateParameter, values: Record<string, unknown> = {}): unknown {
  const v = values[p.name];
  if (v !== undefined && v !== null && v !== "") return v;
  if (p.default !== undefined) return p.default;
  return p.required ? undefined : getPointer(t.vm, p.path);
}

/** Initial form values for the deploy dialog. */
export function initialParameterValues(t: Pick<VMTemplate, "vm" | "parameters">): Record<string, unknown> {
  return Object.fromEntries(t.parameters.map((p) => [p.name, effectiveParameterValue(t, p)]));
}

export function validateParameterValues(t: Pick<VMTemplate, "parameters" | "vm">, values: Record<string, unknown>): ParameterError[] {
  const errors: ParameterError[] = [];
  for (const p of t.parameters) {
    const v = effectiveParameterValue(t, p, values);
    const err = checkParameterValue(p, v);
    if (err) errors.push({ parameter: p.name, message: err });
  }
  return errors;
}

/** Expands a name pattern: "web-{01..03}" → [web-01, web-02, web-03]; "db-{#}" uses a counter. */
export function expandNamePattern(pattern: string, count = 1, start = 1): string[] {
  const range = /\{(\d+)\.\.(\d+)\}/.exec(pattern);
  if (range) {
    const [token, a, b] = range as unknown as [string, string, string];
    const from = Number(a);
    const to = Number(b);
    const width = a.length;
    const out: string[] = [];
    const step = from <= to ? 1 : -1;
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(pattern.replace(token, String(i).padStart(width, "0")));
    return out;
  }
  if (pattern.includes("{#}")) {
    const width = Math.max(2, String(start + count - 1).length);
    return Array.from({ length: count }, (_, i) => pattern.replace("{#}", String(start + i).padStart(width, "0")));
  }
  if (count <= 1) return [pattern];
  const width = Math.max(2, String(start + count - 1).length);
  return Array.from({ length: count }, (_, i) => `${pattern}-${String(start + i).padStart(width, "0")}`);
}

export const MAX_INSTANCES = 50;

export interface InstantiateOptions {
  name: string;
  namespace: string;
  values?: Record<string, unknown>;
  /** Optional full VM override, used by the "customize all fields" flow. */
  overrideSpec?: VirtualMachine["spec"];
  extraLabels?: Record<string, string>;
  powerState?: "On" | "Off";
}

/** Renders a VirtualMachine manifest from a template and parameter values. */
export function instantiateTemplate(t: VMTemplate, opts: InstantiateOptions): VirtualMachine {
  const vm = structuredClone(t.vm) as unknown as Record<string, unknown>;
  if (opts.overrideSpec) vm.spec = structuredClone(opts.overrideSpec);
  else
    for (const p of t.parameters) {
      const value = coerce(p, effectiveParameterValue(t, p, opts.values));
      setPointer(vm, p.path, value);
    }
  const meta = (vm.metadata ?? {}) as { labels?: Record<string, string>; annotations?: Record<string, string> };
  const result = vm as unknown as VirtualMachine;
  result.apiVersion = ApiVersions.vmm;
  result.kind = "VirtualMachine";
  result.metadata = {
    name: opts.name,
    namespace: opts.namespace,
    labels: { ...(meta.labels ?? {}), ...(opts.extraLabels ?? {}), [Labels.template]: t.name },
    annotations: {
      ...(meta.annotations ?? {}),
      [Annotations.sourceTemplate]: `${t.namespace}/${templateConfigMapName(t.name)}`,
      ...(t.resourceVersion ? { [Annotations.sourceTemplateVersion]: t.resourceVersion } : {}),
    },
  };
  if (opts.powerState) result.spec.powerState = opts.powerState;
  delete result.spec.biosUUID;
  return result;
}

/**
 * Validates the VM manifest of a template. Fields bound to a required
 * parameter without default may be left empty in the template body, since
 * the value is always supplied at deploy time. Paths are prefixed with /vm.
 */
export function validateTemplateVM(t: Pick<VMTemplate, "vm" | "parameters">): ValidationIssue[] {
  const supplied = t.parameters.filter((p) => p.required && p.default === undefined).map((p) => p.path);
  return validateVirtualMachine({ ...t.vm, metadata: { ...t.vm.metadata, name: "template" } }, { mode: "template" })
    .filter((i) => !supplied.some((s) => i.path === s || i.path.startsWith(`${s}/`)))
    .map((i) => ({ ...i, path: `/vm${i.path}` }));
}

/** Builds a template from an existing VM. */
export function templateFromVM(vm: VirtualMachine, t: Pick<VMTemplate, "name" | "namespace" | "displayName"> & Partial<VMTemplate>): VMTemplate {
  const clean = cleanVMForCopy(vm);
  const spec = clean.spec;
  delete spec.displayName;
  return VMTemplateSchema.parse({
    tags: [],
    osType: spec.guestCustomization?.type === "Sysprep" ? "Windows" : "Linux",
    parameters: [],
    ...t,
    vm: {
      apiVersion: ApiVersions.vmm,
      kind: "VirtualMachine",
      metadata: { labels: clean.metadata.labels, annotations: clean.metadata.annotations },
      spec,
    },
  });
}

/** Pre-defined, commonly parameterized fields offered by the parameters builder. */
export const SUGGESTED_PARAMETERS: Omit<TemplateParameter, "name">[] = [
  { path: "/spec/displayName", type: "string", label: "Display name" },
  { path: "/spec/description", type: "string", label: "Description" },
  { path: "/spec/context/name", type: "string", label: "Prism Central context" },
  { path: "/spec/placement/cluster", type: "clusterRef", label: "Cluster", required: true },
  { path: "/spec/compute/numSockets", type: "integer", label: "vCPU sockets", min: 1, max: 64 },
  { path: "/spec/compute/numCoresPerSocket", type: "integer", label: "Cores per socket", min: 1, max: 64 },
  { path: "/spec/compute/memorySize", type: "quantity", label: "Memory", min: "512Mi" },
  { path: "/spec/bootConfiguration/bootDisk/source/image", type: "imageRef", label: "Boot image" },
  { path: "/spec/bootConfiguration/bootDisk/diskSize", type: "quantity", label: "Boot disk size" },
  { path: "/spec/network/nics/0/networkInfo/subnet", type: "subnetRef", label: "Primary subnet" },
  { path: "/spec/guestCustomization/secretRef/name", type: "string", label: "Cloud-init / Sysprep secret" },
  { path: "/spec/powerState", type: "enum", label: "Initial power state", options: ["On", "Off"] },
  { path: "/spec/hardwareClockTimezone", type: "string", label: "Hardware clock timezone" },
];

export function suggestParameterName(path: string): string {
  const segs = parsePointer(path).filter((s) => !/^\d+$/.test(s));
  const last = segs.slice(-2).join("_");
  return last.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]+/, "") || "param";
}

export const isValidVMName = (n: string) => n.length <= 253 && DNS1123_LABEL.test(n);
