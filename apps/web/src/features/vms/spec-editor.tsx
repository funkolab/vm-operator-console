import { formatQuantity, type ValidationIssue, type VirtualMachine, type VirtualMachineSpec, type VMCDRom, type VMDataDisk, type VMNic } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Cpu, Disc3, HardDrive, Lock, Network, Plus, Settings2, Tag, Trash2, Wand2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Field, KeyValueEditor, NumberInput, QuantityInput } from "@/components/form";
import { YamlEditor } from "@/components/lazy";
import { ResourceRefPicker } from "@/components/resource-ref-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contextsQuery, guestSecretsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { GuestSecretDialog } from "./guest-secret-dialog";

export type Spec = VirtualMachineSpec;

export interface SpecEditorProps {
  spec: Spec;
  onChange: (spec: Spec) => void;
  namespace?: string;
  issues?: ValidationIssue[];
  /** Path prefix of `spec` in the issue paths (e.g. "/spec" or "/vm/spec"). */
  issuePrefix?: string;
  /** Original VM when editing; enables provisioned-field locking. */
  original?: VirtualMachine;
  mode: "create" | "edit" | "template";
  /** Renders a toggle next to fields that can be parameterized (template mode). */
  paramToggle?: (path: string, label: string) => ReactNode;
  sections?: SectionId[];
}

export type SectionId = "general" | "compute" | "boot" | "storage" | "network" | "customization" | "advanced";

const set = <T extends object, K extends keyof T>(o: T | undefined, k: K, v: T[K]): T => {
  const next = { ...(o ?? ({} as T)) };
  if (v === undefined || v === "") delete next[k];
  else next[k] = v;
  return next;
};

export function SectionCard({
  id,
  icon,
  title,
  description,
  children,
  aside,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="bg-card scroll-mt-20 rounded-xl border">
      <header className="flex items-start gap-3 border-b px-4 py-3 sm:px-5">
        <div className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="grid gap-5 p-4 sm:p-5">{children}</div>
    </section>
  );
}

const SIZE_PRESETS = [
  { name: "Small", sockets: 1, cores: 2, memory: "4Gi" },
  { name: "Medium", sockets: 2, cores: 2, memory: "8Gi" },
  { name: "Large", sockets: 4, cores: 2, memory: "16Gi" },
  { name: "X-Large", sockets: 8, cores: 2, memory: "32Gi" },
];

export function VMSpecEditor({ spec, onChange, namespace, issues = [], issuePrefix = "/spec", original, mode, paramToggle, sections }: SpecEditorProps) {
  const show = (s: SectionId) => !sections || sections.includes(s);
  const err = (p: string) => issues.find((i) => i.path === `${issuePrefix}${p}` || i.path.startsWith(`${issuePrefix}${p}/`))?.message;
  const provisioned = mode === "edit" && !!original?.status?.externalID;
  const lockMsg = provisioned ? "Immutable once the VM is provisioned" : undefined;
  const contexts = useQuery({ ...contextsQuery(namespace ?? ""), enabled: !!namespace && namespace !== "_all" });
  const ctxNames = (contexts.data ?? []).map((c) => c.metadata.name as string);
  const context = spec.context?.name ?? (ctxNames.length === 1 ? ctxNames[0] : undefined);
  const P = (path: string, label: string) => (paramToggle ? paramToggle(path, label) : null);
  const vcpus = (spec.compute?.numSockets ?? 0) * (spec.compute?.numCoresPerSocket ?? 1) * (spec.compute?.numThreadsPerCore ?? 1);
  const isOn = original?.status?.powerState === "On" && spec.powerState !== "Off";

  return (
    <div className="grid gap-5">
      {show("general") && (
        <SectionCard id="general" icon={<Settings2 className="size-4" />} title="General" description="Identity on Nutanix and Prism Central connection">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Display name"
              doc="VirtualMachine/spec/displayName"
              error={err("/displayName")}
              hint={mode !== "template" ? "Defaults to the resource name" : undefined}
              aside={P("/spec/displayName", "Display name")}
            >
              {(id) => <Input id={id} value={spec.displayName ?? ""} maxLength={64} onChange={(e) => onChange(set(spec, "displayName", e.target.value))} />}
            </Field>
            <Field
              label="Prism Central context"
              doc="VirtualMachine/spec/context"
              error={err("/context")}
              locked={lockMsg}
              aside={P("/spec/context/name", "Prism Central context")}
            >
              {(id) => (
                <Select
                  value={spec.context?.name ?? "__auto"}
                  disabled={provisioned}
                  onValueChange={(v) => onChange(set(spec, "context", v === "__auto" ? undefined : { name: v }))}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto">Automatic {ctxNames.length === 1 ? `(${ctxNames[0]})` : "(single context in namespace)"}</SelectItem>
                    {ctxNames.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                    {spec.context?.name && !ctxNames.includes(spec.context.name) && <SelectItem value={spec.context.name}>{spec.context.name}</SelectItem>}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field
              label="Description"
              className="sm:col-span-2"
              doc="VirtualMachine/spec/description"
              error={err("/description")}
              aside={P("/spec/description", "Description")}
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={1000}
                  value={spec.description ?? ""}
                  onChange={(e) => onChange(set(spec, "description", e.target.value))}
                />
              )}
            </Field>
            <Field
              label="Cluster"
              required
              doc="VirtualMachine/spec/placement/cluster"
              error={err("/placement")}
              locked={lockMsg}
              className="sm:col-span-2"
              aside={P("/spec/placement/cluster", "Cluster")}
            >
              {(id) => (
                <ResourceRefPicker
                  id={id}
                  kind="clusters"
                  namespace={namespace}
                  context={context}
                  disabled={provisioned}
                  invalid={!!err("/placement")}
                  value={spec.placement?.cluster}
                  onChange={(v) => onChange({ ...spec, placement: { cluster: v as Spec["placement"]["cluster"] } })}
                />
              )}
            </Field>
          </div>
        </SectionCard>
      )}

      {show("compute") && (
        <SectionCard
          id="compute"
          icon={<Cpu className="size-4" />}
          title="Compute"
          description={mode === "edit" ? "Sockets and memory can be increased while running; other changes require power off" : "vCPU and memory sizing"}
          aside={
            <Badge variant="secondary" className="tabular shrink-0">
              {vcpus} vCPU · {formatQuantity(spec.compute?.memorySize)}
            </Badge>
          }
        >
          {mode !== "edit" && (
            <div className="flex flex-wrap gap-2">
              {SIZE_PRESETS.map((p) => (
                <Button
                  key={p.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ ...spec, compute: { ...spec.compute, numSockets: p.sockets, numCoresPerSocket: p.cores, memorySize: p.memory } })}
                >
                  {p.name}
                  <span className="text-muted-foreground text-xs">
                    {p.sockets * p.cores} vCPU · {p.memory.replace("Gi", " GiB")}
                  </span>
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Sockets"
              required
              doc="VirtualMachine/spec/compute/numSockets"
              error={err("/compute/numSockets")}
              aside={P("/spec/compute/numSockets", "vCPU sockets")}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  value={spec.compute?.numSockets}
                  invalid={!!err("/compute/numSockets")}
                  onChange={(v) => onChange({ ...spec, compute: set(spec.compute, "numSockets", v) })}
                />
              )}
            </Field>
            <Field
              label="Cores per socket"
              doc="VirtualMachine/spec/compute/numCoresPerSocket"
              error={err("/compute/numCoresPerSocket")}
              hint={isOn ? "Requires power off" : undefined}
              aside={P("/spec/compute/numCoresPerSocket", "Cores per socket")}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  placeholder="1"
                  value={spec.compute?.numCoresPerSocket}
                  onChange={(v) => onChange({ ...spec, compute: set(spec.compute, "numCoresPerSocket", v) })}
                />
              )}
            </Field>
            <Field
              label="Threads per core"
              doc="VirtualMachine/spec/compute/numThreadsPerCore"
              error={err("/compute/numThreadsPerCore")}
              hint={isOn ? "Requires power off" : undefined}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  placeholder="1"
                  value={spec.compute?.numThreadsPerCore}
                  onChange={(v) => onChange({ ...spec, compute: set(spec.compute, "numThreadsPerCore", v) })}
                />
              )}
            </Field>
            <Field
              label="Memory"
              required
              doc="VirtualMachine/spec/compute/memorySize"
              error={err("/compute/memorySize")}
              aside={P("/spec/compute/memorySize", "Memory")}
            >
              {(id) => (
                <QuantityInput
                  id={id}
                  value={spec.compute?.memorySize}
                  invalid={!!err("/compute/memorySize")}
                  onChange={(v) => onChange({ ...spec, compute: set(spec.compute, "memorySize", v) })}
                />
              )}
            </Field>
          </div>
        </SectionCard>
      )}

      {show("boot") && (
        <SectionCard id="boot" icon={<HardDrive className="size-4" />} title="Boot" description="Firmware and system disk cloned from an image">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Firmware" doc="VirtualMachine/spec/bootConfiguration/bootType" locked={lockMsg} error={err("/bootConfiguration/bootType")}>
              {() => (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  disabled={provisioned}
                  value={spec.bootConfiguration?.bootType ?? ""}
                  onValueChange={(v) =>
                    onChange({ ...spec, bootConfiguration: set(spec.bootConfiguration, "bootType", (v || undefined) as "uefi" | "legacy" | undefined) })
                  }
                  className="justify-start"
                >
                  <ToggleGroupItem value="uefi" className="px-4">
                    UEFI
                  </ToggleGroupItem>
                  <ToggleGroupItem value="legacy" className="px-4">
                    Legacy BIOS
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </Field>
            <Field
              label="Boot order"
              doc="VirtualMachine/spec/bootConfiguration/bootOrder"
              error={err("/bootConfiguration/bootOrder")}
              hint="Takes effect on next boot"
            >
              {(id) => (
                <Select
                  value={(spec.bootConfiguration?.bootOrder ?? []).join(",") || "__default"}
                  onValueChange={(v) =>
                    onChange({
                      ...spec,
                      bootConfiguration: set(spec.bootConfiguration, "bootOrder", v === "__default" ? undefined : (v.split(",") as ("DISK" | "CDROM")[])),
                    })
                  }
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default">Platform default</SelectItem>
                    <SelectItem value="DISK,CDROM">Disk, then CD-ROM</SelectItem>
                    <SelectItem value="CDROM,DISK">CD-ROM, then disk</SelectItem>
                    <SelectItem value="DISK">Disk only</SelectItem>
                    <SelectItem value="CDROM">CD-ROM only</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field
              label="Boot image"
              required={mode !== "edit"}
              className="sm:col-span-2"
              doc="VirtualMachine/spec/bootConfiguration/bootDisk/source"
              locked={lockMsg}
              error={err("/bootConfiguration/bootDisk/source") ?? err("/bootConfiguration/bootDisk")}
              aside={P("/spec/bootConfiguration/bootDisk/source/image", "Boot image")}
            >
              {(id) => (
                <ResourceRefPicker
                  id={id}
                  kind="images"
                  namespace={namespace}
                  context={context}
                  disabled={provisioned}
                  value={spec.bootConfiguration?.bootDisk?.source?.image}
                  onChange={(v) =>
                    onChange({
                      ...spec,
                      bootConfiguration: {
                        ...spec.bootConfiguration,
                        bootDisk: { ...spec.bootConfiguration?.bootDisk, source: { type: "Image", image: v as never } },
                      },
                    })
                  }
                />
              )}
            </Field>
            <Field
              label="Boot disk size"
              doc="VirtualMachine/spec/bootConfiguration/bootDisk/diskSize"
              error={err("/bootConfiguration/bootDisk/diskSize")}
              hint={provisioned ? "Can only grow" : "Leave empty to use the image size"}
              aside={P("/spec/bootConfiguration/bootDisk/diskSize", "Boot disk size")}
            >
              {(id) => (
                <QuantityInput
                  id={id}
                  value={spec.bootConfiguration?.bootDisk?.diskSize}
                  onChange={(v) =>
                    onChange({
                      ...spec,
                      bootConfiguration: {
                        ...spec.bootConfiguration,
                        bootDisk: set(
                          (spec.bootConfiguration?.bootDisk ?? { source: { type: "Image" } }) as NonNullable<
                            NonNullable<Spec["bootConfiguration"]>["bootDisk"]
                          >,
                          "diskSize",
                          v,
                        ) as never,
                      },
                    })
                  }
                />
              )}
            </Field>
            <Field label="Boot disk bus" doc="VirtualMachine/spec/bootConfiguration/bootDisk/deviceProperties" locked={lockMsg}>
              {(id) => (
                <Select
                  disabled={provisioned}
                  value={spec.bootConfiguration?.bootDisk?.deviceProperties?.adapterType ?? "SCSI"}
                  onValueChange={(v) =>
                    onChange({
                      ...spec,
                      bootConfiguration: {
                        ...spec.bootConfiguration,
                        bootDisk: {
                          ...(spec.bootConfiguration?.bootDisk ?? { source: { type: "Image" } }),
                          deviceProperties: { adapterType: v as "SCSI", deviceIndex: 0 },
                        } as never,
                      },
                    })
                  }
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["SCSI", "PCI", "SATA", "IDE"].map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
        </SectionCard>
      )}

      {show("storage") && (
        <StorageSection
          spec={spec}
          onChange={onChange}
          namespace={namespace}
          context={context}
          err={err}
          original={original}
          provisioned={provisioned}
          isOn={isOn}
        />
      )}
      {show("network") && <NetworkSection spec={spec} onChange={onChange} namespace={namespace} context={context} err={err} original={original} P={P} />}
      {show("customization") && <CustomizationSection spec={spec} onChange={onChange} namespace={namespace} err={err} provisioned={provisioned} mode={mode} />}

      {show("advanced") && (
        <SectionCard
          id="advanced"
          icon={<Tag className="size-4" />}
          title="Categories & advanced"
          description="Prism Central categories, power, clock and drift policy"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label={mode === "edit" ? "Desired power state" : "Power on after creation"}
              doc="VirtualMachine/spec/powerState"
              aside={P("/spec/powerState", "Initial power state")}
            >
              {() => (
                <div className="flex h-9 items-center gap-2">
                  <Switch checked={(spec.powerState ?? "On") === "On"} onCheckedChange={(v) => onChange({ ...spec, powerState: v ? "On" : "Off" })} />
                  <span className="text-sm">{(spec.powerState ?? "On") === "On" ? "On" : "Off"}</span>
                </div>
              )}
            </Field>
            <Field
              label="Hardware clock timezone"
              doc="VirtualMachine/spec/hardwareClockTimezone"
              error={err("/hardwareClockTimezone")}
              aside={P("/spec/hardwareClockTimezone", "Hardware clock timezone")}
            >
              {(id) => (
                <Input
                  id={id}
                  list="tz-list"
                  placeholder="UTC"
                  value={spec.hardwareClockTimezone ?? ""}
                  onChange={(e) => onChange(set(spec, "hardwareClockTimezone", e.target.value))}
                />
              )}
            </Field>
            <Field label="Out-of-band drift" doc="VirtualMachine/spec/outOfBandDriftPolicy">
              {(id) => (
                <Select
                  value={spec.outOfBandDriftPolicy ?? "Report"}
                  onValueChange={(v) => onChange({ ...spec, outOfBandDriftPolicy: v as "Report" | "Enforce" })}
                >
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Report">Report only</SelectItem>
                    <SelectItem value="Enforce">Enforce desired state</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>
          <datalist id="tz-list">
            {["UTC", "Europe/Paris", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney"].map(
              (t) => (
                <option key={t} value={t} />
              ),
            )}
          </datalist>
          <Field label="Categories" doc="VirtualMachine/spec/categories" error={err("/categories")} hint="Categories must already exist in Prism Central">
            {() => (
              <KeyValueEditor
                keyPlaceholder="Environment"
                valuePlaceholder="Production"
                addLabel="Add category"
                value={Object.fromEntries((spec.categories ?? []).map((c) => [c.key, c.value]))}
                onChange={(m) =>
                  onChange(set(spec, "categories", Object.keys(m).length ? Object.entries(m).map(([key, value]) => ({ key, value })) : undefined))
                }
              />
            )}
          </Field>
        </SectionCard>
      )}
    </div>
  );
}

const nextFreeIndex = (used: { adapterType?: string; deviceIndex?: number }[], bus: string, min = 0) => {
  const taken = new Set(used.filter((u) => (u.adapterType ?? "SCSI") === bus).map((u) => u.deviceIndex ?? 0));
  let i = min;
  while (taken.has(i)) i++;
  return i;
};

function StorageSection({
  spec,
  onChange,
  namespace,
  context,
  err,
  original,
  provisioned,
  isOn,
}: {
  spec: Spec;
  onChange: (s: Spec) => void;
  namespace?: string;
  context?: string;
  err: (p: string) => string | undefined;
  original?: VirtualMachine;
  provisioned: boolean;
  isOn: boolean;
}) {
  const disks = spec.storage?.dataDisks ?? [];
  const cdroms = spec.storage?.cdroms ?? [];
  const origKeys = new Set((original?.spec.storage?.dataDisks ?? []).map((d) => `${d.deviceProperties?.adapterType}.${d.deviceProperties?.deviceIndex}`));
  const observed = new Map((original?.status?.disks ?? []).map((d) => [`${d.deviceProperties.adapterType}.${d.deviceProperties.deviceIndex ?? 0}`, d]));
  const setDisks = (d: VMDataDisk[]) => onChange({ ...spec, storage: set(spec.storage, "dataDisks", d.length ? d : undefined) });
  const setCDs = (c: VMCDRom[]) => onChange({ ...spec, storage: set(spec.storage, "cdroms", c.length ? c : undefined) });
  const used = [spec.bootConfiguration?.bootDisk?.deviceProperties ?? { adapterType: "SCSI", deviceIndex: 0 }, ...disks.map((d) => d.deviceProperties ?? {})];

  return (
    <SectionCard id="storage" icon={<HardDrive className="size-4" />} title="Storage" description="Data disks and optical drives">
      <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
        <div>
          <div className="text-sm font-medium">Flash mode</div>
          <div className="text-muted-foreground text-xs">Required for disks using the Flash disk mode</div>
        </div>
        <Switch checked={!!spec.storage?.flashMode} onCheckedChange={(v) => onChange({ ...spec, storage: set(spec.storage, "flashMode", v || undefined) })} />
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Data disks</h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disks.length >= 24}
            onClick={() => setDisks([...disks, { diskSize: "20Gi", deviceProperties: { adapterType: "SCSI", deviceIndex: nextFreeIndex(used, "SCSI", 1) } }])}
          >
            <Plus /> Add disk
          </Button>
        </div>
        {err("/storage/dataDisks") && !disks.length && <p className="text-destructive text-xs">{err("/storage/dataDisks")}</p>}
        {disks.length === 0 && <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">No data disks</p>}
        {disks.map((d, i) => {
          const key = `${d.deviceProperties?.adapterType ?? "SCSI"}.${d.deviceProperties?.deviceIndex ?? 0}`;
          const existing = provisioned && origKeys.has(key);
          const obs = observed.get(key);
          const update = (patch: Partial<VMDataDisk>) => setDisks(disks.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          const pathErr = (p: string) => err(`/storage/dataDisks/${i}${p}`);
          return (
            <div key={i} className={cn("grid gap-3 rounded-lg border p-3", pathErr("") && "border-destructive/50")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {key}
                </Badge>
                {existing && (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="size-3" /> provisioned
                  </Badge>
                )}
                {obs?.sizeBytes ? <span className="text-muted-foreground text-xs">observed {formatQuantity(obs.sizeBytes)}</span> : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive ml-auto size-8"
                  aria-label="Remove disk"
                  onClick={() => setDisks(disks.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Size" error={pathErr("/diskSize")} hint={existing ? "Can only grow" : undefined}>
                  {(id) => <QuantityInput id={id} value={d.diskSize} invalid={!!pathErr("/diskSize")} onChange={(v) => update({ diskSize: v })} />}
                </Field>
                <Field
                  label="Bus"
                  error={pathErr("/deviceProperties")}
                  hint={isOn && d.deviceProperties?.adapterType !== "SCSI" && !existing ? "Requires power off" : undefined}
                >
                  {(id) => (
                    <div className="flex gap-2">
                      <Select
                        disabled={existing}
                        value={d.deviceProperties?.adapterType ?? "SCSI"}
                        onValueChange={(v) =>
                          update({ deviceProperties: { adapterType: v as "SCSI", deviceIndex: nextFreeIndex(used, v, v === "SCSI" ? 1 : 0) } })
                        }
                      >
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["SCSI", "PCI", "SATA", "IDE"].map((b) => (
                            <SelectItem key={b} value={b}>
                              {b}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        disabled={existing}
                        aria-label="Device index"
                        className="w-20"
                        value={d.deviceProperties?.deviceIndex ?? 0}
                        onChange={(e) =>
                          update({ deviceProperties: { adapterType: d.deviceProperties?.adapterType ?? "SCSI", deviceIndex: Number(e.target.value) } })
                        }
                      />
                    </div>
                  )}
                </Field>
                <Field label="Disk mode" error={pathErr("/storageConfig/diskMode")}>
                  {(id) => (
                    <Select
                      disabled={existing}
                      value={d.storageConfig?.diskMode ?? "Standard"}
                      onValueChange={(v) => update({ storageConfig: { ...d.storageConfig, diskMode: v as "Standard" | "Flash" } })}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Standard">Standard</SelectItem>
                        <SelectItem value="Flash">Flash</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label="Source">
                  {(id) => (
                    <Select
                      disabled={existing}
                      value={d.source ? "image" : "blank"}
                      onValueChange={(v) => update({ source: v === "image" ? { type: "Image", image: { type: "name", name: "" } } : undefined })}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blank">Blank disk</SelectItem>
                        <SelectItem value="image">Clone from image</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
              {d.source && (
                <Field label="Image" error={pathErr("/source/image")}>
                  {(id) => (
                    <ResourceRefPicker
                      id={id}
                      kind="images"
                      namespace={namespace}
                      context={context}
                      disabled={existing}
                      value={d.source?.image}
                      onChange={(v) => update({ source: { type: "Image", image: v as never } })}
                    />
                  )}
                </Field>
              )}
              <Field label="Storage container" error={pathErr("/storageConfig/storageContainer")} hint="Optional. Must be local to the VM cluster or shared">
                {(id) => (
                  <ResourceRefPicker
                    id={id}
                    kind="storage-containers"
                    namespace={namespace}
                    context={context}
                    disabled={existing}
                    value={d.storageConfig?.storageContainer}
                    onChange={(v) =>
                      update({
                        storageConfig: {
                          diskMode: d.storageConfig?.diskMode ?? "Standard",
                          storageContainer: v && (v.name || v.extId) ? (v as never) : undefined,
                        },
                      })
                    }
                  />
                )}
              </Field>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Disc3 className="size-4" /> CD-ROM drives
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cdroms.length >= 10}
            onClick={() => setCDs([...cdroms, { adapterType: "SATA", deviceIndex: nextFreeIndex(cdroms, "SATA") }])}
          >
            <Plus /> Add drive
          </Button>
        </div>
        {isOn && <p className="text-muted-foreground text-xs">Adding or removing a CD-ROM drive requires the VM to be powered off.</p>}
        {err("/storage/cdroms") && <p className="text-destructive text-xs">{err("/storage/cdroms")}</p>}
        {cdroms.map((c, i) => (
          <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <Field label="Bus">
              {(id) => (
                <div className="flex gap-2">
                  <Select value={c.adapterType} onValueChange={(v) => setCDs(cdroms.map((x, j) => (j === i ? { ...x, adapterType: v as "SATA" } : x)))}>
                    <SelectTrigger id={id} className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SATA">SATA</SelectItem>
                      <SelectItem value="IDE">IDE</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={0}
                    className="w-20"
                    aria-label="Device index"
                    value={c.deviceIndex}
                    onChange={(e) => setCDs(cdroms.map((x, j) => (j === i ? { ...x, deviceIndex: Number(e.target.value) } : x)))}
                  />
                </div>
              )}
            </Field>
            <Field label="ISO image" hint="Leave empty for an empty drive" error={err(`/storage/cdroms/${i}`)}>
              {(id) => (
                <ResourceRefPicker
                  id={id}
                  kind="images"
                  namespace={namespace}
                  context={context}
                  value={c.image}
                  onChange={(v) => setCDs(cdroms.map((x, j) => (j === i ? { ...x, image: v && (v.name || v.extId) ? (v as never) : undefined } : x)))}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              aria-label="Remove drive"
              onClick={() => setCDs(cdroms.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function NetworkSection({
  spec,
  onChange,
  namespace,
  context,
  err,
  original,
  P,
}: {
  spec: Spec;
  onChange: (s: Spec) => void;
  namespace?: string;
  context?: string;
  err: (p: string) => string | undefined;
  original?: VirtualMachine;
  P: (path: string, label: string) => ReactNode;
}) {
  const nics = spec.network?.nics ?? [];
  const observed = new Map((original?.status?.nics ?? []).map((n) => [n.name, n]));
  const setNics = (n: VMNic[]) => onChange({ ...spec, network: { ...spec.network, nics: n } });
  const nextName = () => {
    let i = nics.length;
    while (nics.some((n) => n.name === `nic${i}`)) i++;
    return `nic${i}`;
  };
  return (
    <SectionCard
      id="network"
      icon={<Network className="size-4" />}
      title="Network"
      description="NICs can be added and removed while the VM is running"
      aside={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={nics.length >= 32}
          onClick={() => setNics([...nics, { name: nextName(), networkInfo: { nicType: "NORMAL_NIC", subnet: { type: "name", name: "" } } }])}
        >
          <Plus /> Add NIC
        </Button>
      }
    >
      {err("/network") && <p className="text-destructive text-xs">{err("/network")}</p>}
      {nics.length === 0 && <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">No network interfaces</p>}
      {nics.map((n, i) => {
        const obs = observed.get(n.name);
        const pathErr = (p: string) => err(`/network/nics/${i}${p}`);
        const update = (patch: Partial<VMNic>) => setNics(nics.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Network className="text-muted-foreground size-4" />
              {obs?.macAddress && <span className="text-muted-foreground font-mono text-xs">{obs.macAddress}</span>}
              {obs && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="size-3" /> provisioned
                </Badge>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive ml-auto size-8"
                aria-label="Remove NIC"
                onClick={() => setNics(nics.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[180px_160px_1fr]">
              <Field label="Name" error={pathErr("/name")}>
                {(id) => <Input id={id} value={n.name} disabled={!!obs} maxLength={63} onChange={(e) => update({ name: e.target.value })} />}
              </Field>
              <Field label="Type">
                {(id) => (
                  <Select
                    disabled={!!obs}
                    value={n.networkInfo?.nicType ?? "NORMAL_NIC"}
                    onValueChange={(v) => update({ networkInfo: { ...n.networkInfo, nicType: v as "NORMAL_NIC" } as never })}
                  >
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL_NIC">Normal</SelectItem>
                      <SelectItem value="DIRECT_NIC">Direct</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field
                label="Subnet"
                required
                error={pathErr("/networkInfo")}
                aside={i === 0 ? P("/spec/network/nics/0/networkInfo/subnet", "Primary subnet") : undefined}
              >
                {(id) => (
                  <ResourceRefPicker
                    id={id}
                    kind="subnets"
                    namespace={namespace}
                    context={context}
                    disabled={!!obs}
                    value={n.networkInfo?.subnet}
                    onChange={(v) => update({ networkInfo: { ...n.networkInfo, subnet: v as never } as never })}
                  />
                )}
              </Field>
            </div>
          </div>
        );
      })}
    </SectionCard>
  );
}

function CustomizationSection({
  spec,
  onChange,
  namespace,
  err,
  provisioned,
  mode,
}: {
  spec: Spec;
  onChange: (s: Spec) => void;
  namespace?: string;
  err: (p: string) => string | undefined;
  provisioned: boolean;
  mode: SpecEditorProps["mode"];
}) {
  const gc = spec.guestCustomization;
  const secrets = useQuery({ ...guestSecretsQuery(namespace ?? ""), enabled: !!namespace && namespace !== "_all" });
  const [dialog, setDialog] = useState(false);
  const kind = !gc ? "none" : gc.secretRef ? "secret" : "kv";
  return (
    <SectionCard
      id="customization"
      icon={<Wand2 className="size-4" />}
      title="Guest customization"
      description={provisioned ? "Immutable once the VM is provisioned" : "Cloud-init (Linux) or Sysprep (Windows)"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Engine" doc="VirtualMachine/spec/guestCustomization/type">
          {() => (
            <ToggleGroup
              type="single"
              variant="outline"
              disabled={provisioned}
              value={gc?.type ?? "none"}
              onValueChange={(v) => {
                if (!v) return;
                if (v === "none") onChange(set(spec, "guestCustomization", undefined));
                else onChange({ ...spec, guestCustomization: { ...(gc ?? { secretRef: { name: "" } }), type: v as "CloudInit" | "Sysprep" } });
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="none" className="px-3">
                None
              </ToggleGroupItem>
              <ToggleGroupItem value="CloudInit" className="px-3">
                Cloud-init
              </ToggleGroupItem>
              <ToggleGroupItem value="Sysprep" className="px-3">
                Sysprep
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </Field>
        {gc && (
          <Field label="Source">
            {(id) => (
              <Select
                disabled={provisioned}
                value={kind}
                onValueChange={(v) =>
                  onChange({
                    ...spec,
                    guestCustomization: v === "secret" ? { type: gc.type, secretRef: { name: "" } } : { type: gc.type, customKeyValues: [] },
                  })
                }
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="secret">Script from a Secret</SelectItem>
                  <SelectItem value="kv">Key/value variables</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
      </div>
      {gc?.secretRef && (
        <Field
          label="Secret"
          doc="VirtualMachine/spec/guestCustomization/secretRef"
          error={err("/guestCustomization")}
          hint={`Secret key "${gc.type === "Sysprep" ? "unattendXml" : "userData"}" holds the ${gc.type === "Sysprep" ? "Unattend.xml" : "cloud-config"}`}
        >
          {(id) => (
            <div className="flex gap-2">
              <Input
                id={id}
                list="guest-secrets"
                disabled={provisioned}
                placeholder="secret name"
                value={gc.secretRef?.name ?? ""}
                onChange={(e) => onChange({ ...spec, guestCustomization: { type: gc.type, secretRef: { name: e.target.value } } })}
              />
              <datalist id="guest-secrets">
                {(secrets.data ?? [])
                  .filter((s) => s.type === gc.type)
                  .map((s) => (
                    <option key={s.name} value={s.name} />
                  ))}
              </datalist>
              {mode !== "edit" && namespace && namespace !== "_all" && (
                <Button type="button" variant="outline" onClick={() => setDialog(true)}>
                  <Plus /> New script
                </Button>
              )}
            </div>
          )}
        </Field>
      )}
      {gc?.customKeyValues && (
        <Field label="Variables" hint="Non-sensitive values only; use a Secret for passwords and keys" error={err("/guestCustomization")}>
          {() => (
            <KeyValueEditor
              disabled={provisioned}
              addLabel="Add variable"
              value={Object.fromEntries(gc.customKeyValues?.map((kv) => [kv.key, kv.value]) ?? [])}
              onChange={(m) =>
                onChange({ ...spec, guestCustomization: { type: gc.type, customKeyValues: Object.entries(m).map(([key, value]) => ({ key, value })) } })
              }
            />
          )}
        </Field>
      )}
      {namespace && gc && (
        <GuestSecretDialog
          open={dialog}
          onOpenChange={setDialog}
          namespace={namespace}
          type={gc.type}
          onCreated={(name) => onChange({ ...spec, guestCustomization: { type: gc.type, secretRef: { name } } })}
        />
      )}
    </SectionCard>
  );
}

export function SpecYaml({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <YamlEditor value={value} onChange={onChange} minHeight="480px" />;
}
