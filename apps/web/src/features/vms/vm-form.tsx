import { DNS1123_LABEL, summarizeChanges, type ValidationIssue, type VirtualMachine, validateVirtualMachine } from "@console/shared";
import { AlertTriangle, CheckCircle2, Code2, FileText, PowerOff } from "lucide-react";
import { useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { Field, KeyValueEditor } from "@/components/form";
import { YamlDiff, YamlEditor } from "@/components/lazy";
import { Spinner } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorIssues } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SectionCard, VMSpecEditor } from "./spec-editor";

const NAV = [
  { id: "identity", label: "Identity" },
  { id: "general", label: "General" },
  { id: "compute", label: "Compute" },
  { id: "boot", label: "Boot" },
  { id: "storage", label: "Storage" },
  { id: "network", label: "Network" },
  { id: "customization", label: "Customization" },
  { id: "advanced", label: "Advanced" },
];

export interface SubmitOptions {
  confirmDiskDeletion?: boolean;
  confirmBootDiskDeletion?: boolean;
}

/**
 * Full VM editor (form or YAML) with live client-side validation mirroring
 * the CRD and admission rules, a review step with diff, and power-off / data
 * loss warnings for day-2 changes.
 */
export function VMForm({
  initial,
  original,
  namespaces,
  mode,
  onSubmit,
  onCancel,
  submitLabel,
  serverError,
}: {
  initial: VirtualMachine;
  original?: VirtualMachine;
  namespaces: string[];
  mode: "create" | "edit";
  onSubmit: (vm: VirtualMachine, opts: SubmitOptions) => Promise<unknown>;
  onCancel: () => void;
  submitLabel: string;
  serverError?: unknown;
}) {
  const [vm, setVm] = useState<VirtualMachine>(initial);
  const [view, setView] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState<string>();
  const [touched, setTouched] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ackDisk, setAckDisk] = useState(false);
  const [ackBoot, setAckBoot] = useState(false);
  const ns = vm.metadata.namespace ?? "";

  const issues: ValidationIssue[] = useMemo(
    () => [...validateVirtualMachine(vm, mode === "edit" ? { mode: "update", old: original } : { mode: "create" }), ...errorIssues(serverError)],
    [vm, mode, original, serverError],
  );
  const changes = original ? summarizeChanges(original, vm) : undefined;
  const visibleIssues = touched || mode === "edit" ? issues : [];
  const nameErr =
    visibleIssues.find((i) => i.path.startsWith("/metadata/name"))?.message ??
    (vm.metadata.name && !DNS1123_LABEL.test(vm.metadata.name) ? "Lowercase letters, digits and '-' only" : undefined);

  const toYaml = () => {
    const { status: _s, ...rest } = vm;
    const meta = { ...rest.metadata };
    for (const k of ["managedFields", "uid", "creationTimestamp", "generation"] as const) delete meta[k];
    return stringify({ ...rest, metadata: meta }, { lineWidth: 0 });
  };
  const switchView = (v: "form" | "yaml") => {
    if (v === view) return;
    if (v === "yaml") {
      setYamlText(toYaml());
      setYamlError(undefined);
    } else if (yamlError) return;
    setView(v);
  };
  const onYaml = (text: string) => {
    setYamlText(text);
    try {
      const parsed = parse(text) as VirtualMachine;
      if (!parsed || typeof parsed !== "object" || !parsed.spec) throw new Error("The document must contain a spec");
      setVm({
        ...parsed,
        metadata: {
          ...parsed.metadata,
          // Identity is controlled by the form in edit mode.
          ...(mode === "edit" ? { name: original?.metadata.name, namespace: original?.metadata.namespace, resourceVersion: vm.metadata.resourceVersion } : {}),
        },
        status: vm.status,
      });
      setYamlError(undefined);
    } catch (e) {
      setYamlError((e as Error).message);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(vm, { confirmDiskDeletion: ackDisk, confirmBootDiskDeletion: ackBoot });
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  const blockingIssues = issues.filter((i) => mode !== "edit" || !i.message.includes("explicit confirmation"));

  return (
    <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
      <nav className="hidden lg:block">
        <div className="sticky top-20 grid gap-1">
          <ToggleGroup type="single" variant="outline" value={view} onValueChange={(v) => v && switchView(v as "form" | "yaml")} className="mb-3 w-full">
            <ToggleGroupItem value="form" className="flex-1">
              <FileText /> Form
            </ToggleGroupItem>
            <ToggleGroupItem value="yaml" className="flex-1" disabled={!!yamlError && view === "yaml"}>
              <Code2 /> YAML
            </ToggleGroupItem>
          </ToggleGroup>
          {view === "form" &&
            NAV.map((n) => {
              const bad = visibleIssues.some((i) =>
                i.path.includes(
                  n.id === "identity"
                    ? "/metadata"
                    : `/spec/${n.id === "general" ? "placement" : n.id === "boot" ? "bootConfiguration" : n.id === "customization" ? "guestCustomization" : n.id}`,
                ),
              );
              return (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className={cn(
                    "text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm",
                    bad && "text-destructive",
                  )}
                >
                  {n.label}
                  {bad && <AlertTriangle className="size-3.5" />}
                </a>
              );
            })}
        </div>
      </nav>
      <div className="grid min-w-0 gap-5">
        <div className="lg:hidden">
          <ToggleGroup type="single" variant="outline" value={view} onValueChange={(v) => v && switchView(v as "form" | "yaml")}>
            <ToggleGroupItem value="form">
              <FileText /> Form
            </ToggleGroupItem>
            <ToggleGroupItem value="yaml">
              <Code2 /> YAML
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {view === "form" ? (
          <>
            <SectionCard id="identity" icon={<FileText className="size-4" />} title="Identity" description="Kubernetes resource name, namespace and labels">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required error={nameErr} locked={mode === "edit" ? "The resource name cannot be changed" : undefined}>
                  {(id) => (
                    <Input
                      id={id}
                      value={vm.metadata.name ?? ""}
                      disabled={mode === "edit"}
                      maxLength={63}
                      placeholder="web-01"
                      aria-invalid={!!nameErr}
                      onChange={(e) => setVm({ ...vm, metadata: { ...vm.metadata, name: e.target.value.toLowerCase() } })}
                    />
                  )}
                </Field>
                <Field label="Namespace" required locked={mode === "edit" ? "The namespace cannot be changed" : undefined}>
                  {(id) => (
                    <Select value={ns} disabled={mode === "edit"} onValueChange={(v) => setVm({ ...vm, metadata: { ...vm.metadata, namespace: v } })}>
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Select a namespace" />
                      </SelectTrigger>
                      <SelectContent>
                        {namespaces.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="Labels" className="sm:col-span-2" hint="Labels let VM services select this VM">
                  {() => (
                    <KeyValueEditor
                      value={vm.metadata.labels ?? {}}
                      addLabel="Add label"
                      onChange={(labels) => setVm({ ...vm, metadata: { ...vm.metadata, labels } })}
                    />
                  )}
                </Field>
              </div>
            </SectionCard>
            <VMSpecEditor spec={vm.spec} onChange={(spec) => setVm({ ...vm, spec })} namespace={ns} issues={visibleIssues} original={original} mode={mode} />
          </>
        ) : (
          <div className="grid gap-2">
            <YamlEditor value={yamlText} onChange={onYaml} minHeight="560px" maxHeight="75vh" />
            {yamlError && <p className="text-destructive text-sm">YAML error: {yamlError}</p>}
            {!yamlError && visibleIssues.length > 0 && (
              <ul className="text-destructive grid gap-1 text-sm">
                {visibleIssues.slice(0, 8).map((i) => (
                  <li key={`${i.path}${i.message}`}>
                    <span className="font-mono text-xs">{i.path}</span>: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {touched && blockingIssues.length > 0 ? (
            <span className="text-destructive flex items-center gap-1.5 text-sm">
              <AlertTriangle className="size-4" /> {blockingIssues.length} issue(s) to fix
            </span>
          ) : changes?.requiresPowerOff.length && original?.status?.powerState === "On" && vm.spec.powerState !== "Off" ? (
            <span className="text-warning flex items-center gap-1.5 text-sm">
              <PowerOff className="size-4" /> Some changes require the VM to be powered off
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="text-success size-4" /> Validated against vm-operator rules
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={!!yamlError || (mode === "edit" && !changes?.changed)}
              onClick={() => {
                setTouched(true);
                if (blockingIssues.length === 0) setReview(true);
                else document.getElementById(blockingIssues[0]?.path.split("/")[2] ?? "identity")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Review
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={review} onOpenChange={(o) => !busy && setReview(o)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{mode === "edit" ? `Apply changes to ${vm.metadata.name}` : `Create ${vm.metadata.name}`}</DialogTitle>
            <DialogDescription>
              {mode === "edit" ? "Review the changes before they are sent to the Kubernetes API." : `The VirtualMachine will be created in ${ns}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-auto">
            {changes && changes.requiresPowerOff.length > 0 && original?.status?.powerState === "On" && (
              <Alert className="border-warning/30 bg-warning/5">
                <PowerOff className="text-warning" />
                <AlertTitle>Power off required</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {changes.requiresPowerOff.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {vm.spec.powerState !== "Off" && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => setVm({ ...vm, spec: { ...vm.spec, powerState: "Off" } })}>
                      Power off as part of this change
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {changes && changes.dataDisksRemoved.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Data disks will be permanently deleted</AlertTitle>
                <AlertDescription>
                  <p>
                    {changes.dataDisksRemoved.map((d) => `${d.deviceProperties?.adapterType}.${d.deviceProperties?.deviceIndex}`).join(", ")} and their data
                    will be destroyed on Nutanix.
                  </p>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox checked={ackDisk} onCheckedChange={(v) => setAckDisk(!!v)} /> I understand, delete these disks
                  </label>
                </AlertDescription>
              </Alert>
            )}
            {changes?.bootDiskRemoved && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>The boot disk will be deleted</AlertTitle>
                <AlertDescription>
                  <p>The VM keeps running but will not boot again until another bootable disk is attached.</p>
                  <label className="mt-2 flex items-center gap-2">
                    <Checkbox checked={ackBoot} onCheckedChange={(v) => setAckBoot(!!v)} /> I understand, delete the boot disk
                  </label>
                </AlertDescription>
              </Alert>
            )}
            {mode === "edit" && original ? (
              <YamlDiff
                original={stringify({ metadata: { labels: original.metadata.labels }, spec: original.spec }, { lineWidth: 0 })}
                modified={stringify({ metadata: { labels: vm.metadata.labels }, spec: vm.spec }, { lineWidth: 0 })}
              />
            ) : (
              <YamlEditor value={toYaml()} readOnly minHeight="300px" maxHeight="50vh" />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setReview(false)}>
              Back
            </Button>
            <Button disabled={busy || (!!changes?.dataDisksRemoved.length && !ackDisk) || (!!changes?.bootDiskRemoved && !ackBoot)} onClick={submit}>
              {busy && <Spinner />} {submitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
