import { z } from "zod";
import { DNS1123_SUBDOMAIN } from "./constants";

export const OwnerReferenceSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  name: z.string(),
  uid: z.string(),
  controller: z.boolean().optional(),
  blockOwnerDeletion: z.boolean().optional(),
});

export const ObjectMetaSchema = z.looseObject({
  name: z.string().max(253).regex(DNS1123_SUBDOMAIN, "Must be a lowercase RFC 1123 subdomain").optional(),
  generateName: z.string().optional(),
  namespace: z.string().optional(),
  uid: z.string().optional(),
  resourceVersion: z.string().optional(),
  generation: z.number().optional(),
  creationTimestamp: z.string().nullish(),
  deletionTimestamp: z.string().nullish(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  finalizers: z.array(z.string()).optional(),
  ownerReferences: z.array(OwnerReferenceSchema).optional(),
  managedFields: z.array(z.unknown()).optional(),
});
export type ObjectMeta = z.infer<typeof ObjectMetaSchema>;

export const ConditionSchema = z.looseObject({
  type: z.string(),
  status: z.enum(["True", "False", "Unknown"]),
  reason: z.string().optional(),
  message: z.string().optional(),
  lastTransitionTime: z.string().optional(),
  observedGeneration: z.number().optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata: ObjectMeta;
}

export interface KubeList<T> {
  apiVersion?: string;
  kind?: string;
  metadata: { resourceVersion?: string; continue?: string };
  items: T[];
}

export const ConfigMapSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema,
  data: z.record(z.string(), z.string()).optional(),
});
export type ConfigMap = z.infer<typeof ConfigMapSchema>;

export const SecretSchema = z.looseObject({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: ObjectMetaSchema,
  type: z.string().optional(),
  data: z.record(z.string(), z.string()).optional(),
  stringData: z.record(z.string(), z.string()).optional(),
});
export type Secret = z.infer<typeof SecretSchema>;

export interface KubeEvent {
  metadata: ObjectMeta;
  involvedObject: { kind?: string; namespace?: string; name?: string; uid?: string; apiVersion?: string };
  reason?: string;
  message?: string;
  type?: "Normal" | "Warning" | string;
  count?: number;
  firstTimestamp?: string | null;
  lastTimestamp?: string | null;
  eventTime?: string | null;
  series?: { count?: number; lastObservedTime?: string };
  source?: { component?: string };
  reportingComponent?: string;
}

export interface KubeService extends KubeObject {
  spec?: {
    type?: string;
    clusterIP?: string;
    clusterIPs?: string[];
    ports?: { name?: string; port: number; targetPort?: number | string; protocol?: string }[];
  };
  status?: { loadBalancer?: { ingress?: { ip?: string; hostname?: string }[] } };
}

export interface EndpointSlice extends KubeObject {
  addressType?: string;
  endpoints?: {
    addresses: string[];
    conditions?: { ready?: boolean; serving?: boolean; terminating?: boolean };
    targetRef?: { kind?: string; name?: string; namespace?: string };
  }[];
  ports?: { name?: string; port?: number; protocol?: string }[];
}

export function getCondition(conditions: Condition[] | undefined, type: string): Condition | undefined {
  return conditions?.find((c) => c.type === type);
}

export function isConditionTrue(conditions: Condition[] | undefined, type: string): boolean {
  return getCondition(conditions, type)?.status === "True";
}

export function eventTimestamp(e: KubeEvent): string | undefined {
  return e.series?.lastObservedTime ?? e.lastTimestamp ?? e.eventTime ?? e.firstTimestamp ?? e.metadata.creationTimestamp ?? undefined;
}

export const LabelSelectorSchema = z.looseObject({
  matchLabels: z.record(z.string(), z.string()).optional(),
  matchExpressions: z
    .array(
      z.looseObject({
        key: z.string().min(1),
        operator: z.enum(["In", "NotIn", "Exists", "DoesNotExist"]),
        values: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});
export type LabelSelector = z.infer<typeof LabelSelectorSchema>;

/** Structural selector type accepted by helpers (the CRD types `operator` as a plain string). */
export interface LabelSelectorLike {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

/** Evaluates a Kubernetes label selector against a label map. */
export function matchesSelector(selector: LabelSelectorLike | undefined, labels: Record<string, string> = {}): boolean {
  if (!selector) return false;
  const ml = selector.matchLabels ?? {};
  const me = selector.matchExpressions ?? [];
  if (Object.keys(ml).length === 0 && me.length === 0) return true;
  for (const [k, v] of Object.entries(ml)) if (labels[k] !== v) return false;
  for (const e of me) {
    const has = Object.hasOwn(labels, e.key);
    const val = labels[e.key];
    switch (e.operator) {
      case "In":
        if (!has || !(e.values ?? []).includes(val as string)) return false;
        break;
      case "NotIn":
        if (has && (e.values ?? []).includes(val as string)) return false;
        break;
      case "Exists":
        if (!has) return false;
        break;
      case "DoesNotExist":
        if (has) return false;
        break;
    }
  }
  return true;
}

/** Serializes a label selector into the `labelSelector` query parameter format. */
export function selectorToString(selector: LabelSelectorLike): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) parts.push(`${k}=${v}`);
  for (const e of selector.matchExpressions ?? []) {
    if (e.operator === "Exists") parts.push(e.key);
    else if (e.operator === "DoesNotExist") parts.push(`!${e.key}`);
    else parts.push(`${e.key} ${e.operator.toLowerCase()} (${(e.values ?? []).join(",")})`);
  }
  return parts.join(",");
}
