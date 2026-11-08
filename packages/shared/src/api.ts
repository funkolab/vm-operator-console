import { z } from "zod";
import { DNS1123_LABEL } from "./constants";

export const RESOURCES = ["virtualmachines", "virtualmachineservices", "nutanixprismcontexts", "configmaps", "secrets", "events"] as const;
export type ResourceName = (typeof RESOURCES)[number];
export const VERBS = ["list", "get", "create", "update", "patch", "delete"] as const;
export type Verb = (typeof VERBS)[number];

export type PermissionMatrix = Partial<Record<ResourceName, Partial<Record<Verb, boolean>>>>;

export interface NamespaceAccess {
  name: string;
  permissions: PermissionMatrix;
}

export interface MeResponse {
  user: string;
  groups: string[];
  authMode: string;
  namespaces: NamespaceAccess[];
  clusterWide: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    status: number;
    details?: { path: string; message: string }[];
  };
}

export const NamespaceParam = z.object({ ns: z.string().regex(DNS1123_LABEL).max(63) });
export const NamedParam = NamespaceParam.extend({ name: z.string().min(1).max(253) });

export const DryRunQuery = z.object({ dryRun: z.enum(["true", "false"]).optional() });

export const PowerActionSchema = z.enum(["start", "stop", "restart", "pause", "resume"]);
export type PowerAction = z.infer<typeof PowerActionSchema>;

export const BulkActionSchema = z.object({
  action: z.enum(["start", "stop", "restart", "pause", "resume", "delete", "label"]),
  targets: z
    .array(z.object({ namespace: z.string(), name: z.string() }))
    .min(1)
    .max(200),
  labels: z.record(z.string(), z.string().nullable()).optional(),
});
export type BulkAction = z.infer<typeof BulkActionSchema>;

export interface BulkResult {
  results: { namespace: string; name: string; ok: boolean; error?: string }[];
}

export const InstantiateRequestSchema = z.object({
  namePattern: z.string().min(1).max(240),
  count: z.number().int().min(1).max(50).default(1),
  values: z.record(z.string(), z.unknown()).default({}),
  overrideSpec: z.record(z.string(), z.unknown()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  powerState: z.enum(["On", "Off"]).optional(),
  dryRun: z.boolean().optional(),
});
export type InstantiateRequest = z.input<typeof InstantiateRequestSchema>;

export interface InstantiateResult {
  results: { name: string; ok: boolean; error?: string; details?: { path: string; message: string }[] }[];
}

export const CloneRequestSchema = z.object({
  name: z.string().regex(DNS1123_LABEL, "Must be a lowercase RFC 1123 label").max(63),
  namespace: z.string().optional(),
  displayName: z.string().max(64).optional(),
  powerState: z.enum(["On", "Off"]).optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
});

export const SaveAsTemplateRequestSchema = z.object({
  name: z.string().regex(DNS1123_LABEL, "Must be a lowercase RFC 1123 label").max(58),
  displayName: z.string().min(1).max(128),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).default([]),
  osType: z.enum(["Linux", "Windows", "Other"]).optional(),
  parameters: z.array(z.unknown()).optional(),
});

export const PrismAccountRequestSchema = z
  .object({
    name: z.string().regex(DNS1123_LABEL, "Must be a lowercase RFC 1123 label").max(63),
    address: z.string().min(1, "Address is required"),
    port: z.number().int().min(1).max(65535).default(9440),
    tlsMode: z.enum(["Secure", "Insecure"]).default("Secure"),
    caBundle: z.string().optional(),
    caBundleRef: z.string().optional(),
    project: z.object({ type: z.enum(["extId", "name"]), name: z.string().optional(), extId: z.string().optional() }).optional(),
    credential: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("basic"), username: z.string().min(1), password: z.string().min(1) }),
      z.object({ mode: z.literal("apiKey"), apiKey: z.string().min(1) }),
      z.object({ mode: z.literal("existing"), secretName: z.string().min(1), secretNamespace: z.string().optional() }),
    ]),
  })
  .superRefine((v, ctx) => {
    if (v.tlsMode === "Secure" && !v.caBundle && !v.caBundleRef)
      ctx.addIssue({ code: "custom", path: ["caBundle"], message: "A CA bundle is required in Secure mode" });
  });
export type PrismAccountRequest = z.input<typeof PrismAccountRequestSchema>;

export const RotateCredentialSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("basic"), username: z.string().min(1), password: z.string().min(1) }),
  z.object({ mode: z.literal("apiKey"), apiKey: z.string().min(1) }),
]);

export const TestConnectionSchema = z.object({
  address: z.string().min(1),
  port: z.number().int().default(9440),
  tlsMode: z.enum(["Secure", "Insecure"]).default("Secure"),
  caBundle: z.string().optional(),
  credential: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("basic"), username: z.string(), password: z.string() }),
    z.object({ mode: z.literal("apiKey"), apiKey: z.string() }),
  ]),
});
export type TestConnectionRequest = z.input<typeof TestConnectionSchema>;

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  pcVersion?: string;
  latencyMs?: number;
}

export interface CredentialInfo {
  secretName: string;
  secretNamespace: string;
  exists: boolean;
  mode?: "basic" | "apiKey";
  username?: string;
  managed: boolean;
  updatedAt?: string;
}

export interface CatalogItem {
  extId: string;
  name: string;
  description?: string;
  /** Extra attributes for display, e.g. cluster name, VLAN, size. */
  info?: Record<string, string>;
}
export const CATALOG_KINDS = ["clusters", "subnets", "images", "storage-containers", "categories", "projects"] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogResponse {
  items: CatalogItem[];
  available: boolean;
  message?: string;
}

export type WatchKind = "virtualmachines" | "virtualmachineservices" | "nutanixprismcontexts" | "configmaps" | "events";

export interface StreamMessage {
  kind: WatchKind;
  type: "ADDED" | "MODIFIED" | "DELETED";
  namespace: string;
  name: string;
  object?: unknown;
}

export interface DashboardStats {
  vms: {
    total: number;
    byPhase: Record<string, number>;
    on: number;
    off: number;
    ready: number;
    notReady: number;
    drifted: number;
    activeTasks: number;
    paused: number;
  };
  capacity: { vcpus: number; memoryBytes: number; diskBytes: number };
  byCluster: { cluster: string; count: number; vcpus: number; memoryBytes: number }[];
  byNamespace: { namespace: string; count: number; on: number }[];
  contexts: { total: number; connected: number; disconnected: number };
  services: { total: number; ready: number; selectedVms: number; readyEndpoints: number };
  templates: number;
  attention: { kind: string; namespace: string; name: string; reason: string; message?: string }[];
}
