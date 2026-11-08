import type { VMTemplate } from "@console/shared";
import { stringify } from "yaml";

/** Portable YAML export of a template (importable via the library "Import" action). */
export function templateExportYaml(t: VMTemplate & { invalid?: string }) {
  const { resourceVersion: _rv, usageCount: _u, createdAt: _c, createdBy: _cb, updatedBy: _ub, invalid: _i, ...rest } = t;
  return stringify({ kind: "VMTemplate", ...rest }, { lineWidth: 0 });
}
