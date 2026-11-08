import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import { DNS1123_SUBDOMAIN } from "./constants";

/**
 * Guest customization scripts: cloud-init user-data or Sysprep Unattend.xml
 * stored in labelled Secrets, referenced by VMs through
 * spec.guestCustomization.secretRef (same namespace only).
 */
export const GUEST_SCRIPT_TYPES = ["CloudInit", "Sysprep"] as const;
export type GuestScriptType = (typeof GUEST_SCRIPT_TYPES)[number];

/** Secret key read by vm-operator for each engine. */
export const GUEST_SCRIPT_KEYS: Record<GuestScriptType, string> = { CloudInit: "userData", Sysprep: "unattendXml" };

export const GUEST_SCRIPT_LABELS: Record<GuestScriptType, string> = { CloudInit: "Cloud-init", Sysprep: "Sysprep" };

export const GUEST_SCRIPT_MAX_BYTES = 64 * 1024;

export const GuestScriptUpdateSchema = z.object({
  type: z.enum(GUEST_SCRIPT_TYPES),
  content: z
    .string()
    .min(1, "The script is empty")
    .refine((s) => new TextEncoder().encode(s).length <= GUEST_SCRIPT_MAX_BYTES, `At most ${GUEST_SCRIPT_MAX_BYTES / 1024} KiB`),
  description: z.string().max(500).optional(),
  /** Optimistic concurrency: the version the edit started from. */
  resourceVersion: z.string().optional(),
});
export type GuestScriptUpdate = z.infer<typeof GuestScriptUpdateSchema>;

export const GuestScriptCreateSchema = GuestScriptUpdateSchema.omit({ resourceVersion: true }).extend({
  name: z.string().max(253).regex(DNS1123_SUBDOMAIN, "Lowercase letters, digits, '-' and '.'"),
});
export type GuestScriptCreate = z.infer<typeof GuestScriptCreateSchema>;

export interface GuestScriptUsage {
  vms: { name: string; provisioned: boolean }[];
  templates: { name: string; displayName: string }[];
}

export interface GuestScriptSummary {
  name: string;
  namespace: string;
  type: GuestScriptType;
  description?: string;
  sizeBytes: number;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
  usage: { vms: number; templates: number };
}

export interface GuestScript extends Omit<GuestScriptSummary, "usage"> {
  resourceVersion?: string;
  /** Undefined when the user may list the Secret but not read it. */
  content?: string;
  usage: GuestScriptUsage;
}

export interface GuestScriptIssue {
  severity: "error" | "warning";
  message: string;
  line?: number;
}

const CLOUD_INIT_HEADERS = ["#cloud-config", "#!", "#include", "#cloud-boothook", "#part-handler", "## template: jinja", "Content-Type:"];

/**
 * Checks a script before it is saved. Errors block the save (cloud-init would
 * ignore or fail on the payload); warnings are shown only. XML well-formedness
 * of Sysprep files is checked in the browser, which has an XML parser.
 */
export function lintGuestScript(type: GuestScriptType, content: string): GuestScriptIssue[] {
  const out: GuestScriptIssue[] = [];
  const text = content.replace(/^\uFEFF/, "");
  if (!text.trim()) return [{ severity: "error", message: "The script is empty" }];
  if (type === "CloudInit") {
    const first = text.trimStart().split("\n", 1)[0]?.trimEnd() ?? "";
    if (!CLOUD_INIT_HEADERS.some((h) => first.startsWith(h)))
      out.push({ severity: "warning", line: 1, message: "cloud-init ignores user-data that does not start with #cloud-config, #! or a MIME header" });
    if (first.startsWith("#cloud-config")) {
      const lines = new LineCounter();
      const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false });
      for (const e of doc.errors) out.push({ severity: "error", line: lines.linePos(e.pos[0]).line, message: `YAML: ${e.message.split("\n")[0]}` });
      if (!doc.errors.length) {
        const js: unknown = doc.toJS();
        if (js === null || js === undefined) out.push({ severity: "warning", message: "The cloud-config document has no settings" });
        else if (typeof js !== "object" || Array.isArray(js))
          out.push({ severity: "error", message: "A cloud-config document must be a YAML mapping (key: value)" });
      }
    }
  } else if (!/<unattend[\s>]/.test(text)) {
    out.push({ severity: "warning", message: "No <unattend> element: Sysprep expects an Unattend.xml answer file" });
  }
  return out;
}
