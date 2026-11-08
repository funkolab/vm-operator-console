import { GUEST_SCRIPT_KEYS, GUEST_SCRIPT_LABELS, GUEST_SCRIPT_MAX_BYTES, type GuestScriptIssue, type GuestScriptType, lintGuestScript } from "@console/shared";
import { AlertTriangle, CircleCheck, XCircle } from "lucide-react";
import { useMemo } from "react";
import { YamlEditor } from "@/components/lazy";
import { cn } from "@/lib/utils";

export const CLOUD_INIT_SAMPLE = `#cloud-config
hostname: my-vm
users:
  - name: ops
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA... user@example
package_update: true
packages:
  - qemu-guest-agent
runcmd:
  - systemctl enable --now qemu-guest-agent
`;

export const SYSPREP_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>WIN-VM</ComputerName>
      <TimeZone>UTC</TimeZone>
    </component>
  </settings>
</unattend>
`;

export const SAMPLES: Record<GuestScriptType, string> = { CloudInit: CLOUD_INIT_SAMPLE, Sysprep: SYSPREP_SAMPLE };

/** Checks done in the browser on top of the shared lint (the browser has an XML parser). */
export function scriptIssues(type: GuestScriptType, content: string): GuestScriptIssue[] {
  const issues = lintGuestScript(type, content);
  if (type === "Sysprep" && content.trim()) {
    const doc = new DOMParser().parseFromString(content, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) {
      const text = err.textContent ?? "";
      const line = Number(/line (\d+)/i.exec(text)?.[1]) || undefined;
      issues.unshift({
        severity: "error",
        line,
        message: `XML: ${
          text
            .split("\n")
            .find((l) => l.trim() && !/^This page contains/i.test(l))
            ?.trim() ?? "not well-formed"
        }`,
      });
    }
  }
  const size = new TextEncoder().encode(content).length;
  if (size > GUEST_SCRIPT_MAX_BYTES)
    issues.unshift({ severity: "error", message: `${Math.ceil(size / 1024)} KiB, the limit is ${GUEST_SCRIPT_MAX_BYTES / 1024} KiB` });
  return issues;
}

export const hasErrors = (issues: GuestScriptIssue[]) => issues.some((i) => i.severity === "error");

/** Code editor for a cloud-config or Unattend.xml, with live checks below it. */
export function ScriptEditor({
  type,
  value,
  onChange,
  readOnly,
  minHeight = "320px",
  maxHeight = "60vh",
}: {
  type: GuestScriptType;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  minHeight?: string;
  maxHeight?: string;
}) {
  const issues = useMemo(() => scriptIssues(type, value), [type, value]);
  return (
    <div className="grid gap-2">
      <YamlEditor
        value={value}
        onChange={onChange ?? (() => {})}
        readOnly={readOnly}
        minHeight={minHeight}
        maxHeight={maxHeight}
        language={type === "CloudInit" ? "yaml" : "text"}
      />
      {!readOnly && <ScriptIssues issues={issues} type={type} />}
    </div>
  );
}

export function ScriptIssues({ issues, type }: { issues: GuestScriptIssue[]; type: GuestScriptType }) {
  if (!issues.length)
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <CircleCheck className="text-success size-3.5" />
        Valid {GUEST_SCRIPT_LABELS[type]} {type === "CloudInit" ? "user-data" : "answer file"} · stored under the Secret key{" "}
        <span className="font-mono">{GUEST_SCRIPT_KEYS[type]}</span>
      </p>
    );
  return (
    <ul className="grid gap-1">
      {issues.map((i) => (
        <li
          key={`${i.severity}-${i.line ?? 0}-${i.message}`}
          className={cn("flex items-start gap-1.5 text-xs", i.severity === "error" ? "text-destructive" : "text-warning")}
        >
          {i.severity === "error" ? <XCircle className="mt-px size-3.5 shrink-0" /> : <AlertTriangle className="mt-px size-3.5 shrink-0" />}
          <span>
            {i.line && <span className="font-mono">Line {i.line}: </span>}
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
