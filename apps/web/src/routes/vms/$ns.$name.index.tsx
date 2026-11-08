import { Annotations, formatBytes, formatQuantity, refLabel, summarizeVM, type VirtualMachine, VirtualMachineConditionOrder } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Cpu, Disc3, HardDrive, Info, LayoutTemplate, Loader2, MemoryStick, Network, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { stringify } from "yaml";
import { z } from "zod";
import { Copyable } from "@/components/copy-button";
import { KeyValueEditor } from "@/components/form";
import { YamlEditor } from "@/components/lazy";
import { DescriptionList, EmptyState, ErrorState, LoadingState, Page, PageHeader, Section } from "@/components/page";
import { ConditionList, PausedBadge, PhaseBadge, ReadyBadge } from "@/components/status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventList } from "@/features/events/event-list";
import { VMActions } from "@/features/vms/actions";
import { api, errorMessage, unwrap } from "@/lib/api";
import { downloadText, formatDate, relativeTime } from "@/lib/format";
import { useCan, vmEventsQuery, vmQuery, vmServicesQuery } from "@/lib/queries";

const TABS = ["overview", "hardware", "network", "drift", "events", "services", "yaml", "metadata"] as const;

export const Route = createFileRoute("/vms/$ns/$name/")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(vmQuery(params.ns, params.name)),
  pendingComponent: () => (
    <Page>
      <LoadingState rows={8} />
    </Page>
  ),
  errorComponent: ({ error, reset }) => (
    <Page>
      <ErrorState error={error} onRetry={reset} />
    </Page>
  ),
  component: VMDetailPage,
});

function VMDetailPage() {
  const { ns, name } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(vmQuery(ns, name));
  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const vm = q.data;
  const s = summarizeVM(vm);
  const task = vm.status?.activeTask;
  const restartPending = vm.metadata.annotations?.[Annotations.restartPending];

  return (
    <Page>
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-2">
          <Link to="/vms">
            <ArrowLeft /> Virtual machines
          </Link>
        </Button>
        <PageHeader
          icon={<Server className="size-5" />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {s.displayName}
              <PhaseBadge phase={s.phase} />
              {s.paused && <PausedBadge />}
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono">
                {ns}/{name}
              </span>
              {s.primaryIP && <Copyable value={s.primaryIP} />}
              {s.template && (
                <Link to="/templates/$ns/$name" params={{ ns, name: s.template }} className="inline-flex items-center gap-1 hover:underline">
                  <LayoutTemplate className="size-3.5" /> {s.template}
                </Link>
              )}
            </span>
          }
          actions={<VMActions vm={vm} variant="buttons" />}
        />
      </div>

      {(task || restartPending || s.converging) && (
        <Alert className="border-info/30 bg-info/5">
          <Loader2 className="text-info animate-spin" />
          <AlertTitle>{task ? `Operation in progress: ${task.kind}` : restartPending ? "Restart in progress" : "Applying changes"}</AlertTitle>
          <AlertDescription>
            {task
              ? `Prism Central task ${task.extId}${task.targetName ? ` for ${task.targetName}` : ""}.`
              : restartPending
                ? "Waiting for the VM to power off before powering it back on."
                : `The controller is converging generation ${vm.metadata.generation} (applied: ${vm.status?.appliedGeneration ?? 0}).`}
          </AlertDescription>
        </Alert>
      )}
      {s.paused && (
        <Alert className="border-warning/30 bg-warning/5">
          <Info className="text-warning" />
          <AlertTitle>Reconciliation paused</AlertTitle>
          <AlertDescription>The operator ignores changes to this VM until reconciliation is resumed.</AlertDescription>
        </Alert>
      )}
      {s.phase === "Error" && s.readyMessage && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{s.readyReason}</AlertTitle>
          <AlertDescription>{s.readyMessage}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as (typeof TABS)[number] }, replace: true })}>
        <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="drift">
              Drift {s.driftCount > 0 && <Badge className="bg-warning text-black h-4 px-1 text-[10px]">{s.driftCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4">
          <Overview vm={vm} />
        </TabsContent>
        <TabsContent value="hardware" className="mt-4">
          <Hardware vm={vm} />
        </TabsContent>
        <TabsContent value="network" className="mt-4">
          <NetworkTab vm={vm} />
        </TabsContent>
        <TabsContent value="drift" className="mt-4">
          <Drift vm={vm} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab ns={ns} name={name} />
        </TabsContent>
        <TabsContent value="services" className="mt-4">
          <ServicesTab ns={ns} name={name} />
        </TabsContent>
        <TabsContent value="yaml" className="mt-4">
          <YamlTab vm={vm} />
        </TabsContent>
        <TabsContent value="metadata" className="mt-4">
          <MetadataTab vm={vm} />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-4">
      <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">{icon}</div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="tabular truncate text-lg font-semibold">{value}</div>
        {sub && <div className="text-muted-foreground truncate text-xs">{sub}</div>}
      </div>
    </div>
  );
}

function Overview({ vm }: { vm: VirtualMachine }) {
  const s = summarizeVM(vm);
  const c = vm.spec.compute;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Cpu className="size-5" />}
          label="vCPU"
          value={s.vcpus}
          sub={`${c?.numSockets ?? 0} socket × ${c?.numCoresPerSocket ?? 1} core × ${c?.numThreadsPerCore ?? 1} thread`}
        />
        <Stat icon={<MemoryStick className="size-5" />} label="Memory" value={formatQuantity(c?.memorySize)} />
        <Stat icon={<HardDrive className="size-5" />} label="Storage" value={s.diskBytes ? formatBytes(s.diskBytes) : "—"} sub={`${s.diskCount} disk(s)`} />
        <Stat icon={<Network className="size-5" />} label="Network" value={s.primaryIP ?? "No IP"} sub={`${s.nicCount} NIC(s)`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Section title="Details">
          <DescriptionList
            items={[
              { label: "Power", value: `${vm.status?.powerState ?? "Unknown"} (desired: ${s.desiredPowerState})` },
              { label: "Ready", value: <ReadyBadge status={s.ready} reason={s.readyReason} /> },
              { label: "Cluster", value: refLabel(vm.spec.placement?.cluster) },
              {
                label: "Prism Central",
                value: s.context ? (
                  <Link to="/contexts/$ns/$name" params={{ ns: s.namespace, name: s.context }} className="hover:underline">
                    {s.context}
                  </Link>
                ) : (
                  "—"
                ),
              },
              { label: "Firmware", value: vm.spec.bootConfiguration?.bootType?.toUpperCase() ?? "Default" },
              { label: "Boot image", value: refLabel(vm.spec.bootConfiguration?.bootDisk?.source?.image) },
              {
                label: "Guest customization",
                value: vm.spec.guestCustomization
                  ? `${vm.spec.guestCustomization.type}${vm.spec.guestCustomization.secretRef ? ` (secret ${vm.spec.guestCustomization.secretRef.name})` : ""}`
                  : "None",
              },
              { label: "Drift policy", value: vm.spec.outOfBandDriftPolicy ?? "Report" },
              { label: "VM UUID", value: <Copyable value={vm.status?.externalID} /> },
              { label: "BIOS UUID", value: <Copyable value={vm.spec.biosUUID} /> },
              {
                label: "Generation",
                value: `${vm.metadata.generation ?? 0} (observed ${vm.status?.observedGeneration ?? 0}, applied ${vm.status?.appliedGeneration ?? 0})`,
              },
              { label: "Created", value: `${formatDate(vm.metadata.creationTimestamp)} (${relativeTime(vm.metadata.creationTimestamp)})` },
              { label: "Description", value: vm.spec.description || "—", hidden: !vm.spec.description },
            ]}
          />
          {!!vm.spec.categories?.length && (
            <div className="mt-4">
              <div className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {vm.spec.categories.map((c) => (
                  <Badge key={`${c.key}=${c.value}`} variant="secondary">
                    {c.key}: {c.value}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Section>
        <Section title="Conditions" description="Status reported by vm-operator">
          <ConditionList conditions={vm.status?.conditions} order={VirtualMachineConditionOrder} />
        </Section>
      </div>
    </div>
  );
}

function Hardware({ vm }: { vm: VirtualMachine }) {
  const boot = vm.spec.bootConfiguration?.bootDisk;
  const observed = new Map((vm.status?.disks ?? []).map((d) => [`${d.deviceProperties.adapterType}.${d.deviceProperties.deviceIndex ?? 0}`, d]));
  return (
    <div className="grid gap-5">
      <Section title="Disks" description={vm.spec.storage?.flashMode ? "Flash mode enabled" : undefined}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Mode / container</TableHead>
                <TableHead>Disk UUID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boot && (
                <TableRow>
                  <TableCell className="font-mono">
                    {boot.deviceProperties?.adapterType ?? "SCSI"}.{boot.deviceProperties?.deviceIndex ?? 0}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">Boot</Badge>
                  </TableCell>
                  <TableCell>{boot.diskSize ? formatQuantity(boot.diskSize) : "Image size"}</TableCell>
                  <TableCell>{refLabel(boot.source?.image)}</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                </TableRow>
              )}
              {(vm.spec.storage?.dataDisks ?? []).map((d) => {
                const key = `${d.deviceProperties?.adapterType ?? "SCSI"}.${d.deviceProperties?.deviceIndex ?? 0}`;
                const obs = observed.get(key);
                return (
                  <TableRow key={key}>
                    <TableCell className="font-mono">{key}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">Data</Badge>
                    </TableCell>
                    <TableCell>
                      {formatQuantity(d.diskSize)}
                      {obs?.sizeBytes ? <span className="text-muted-foreground ml-1 text-xs">(observed {formatBytes(obs.sizeBytes)})</span> : null}
                    </TableCell>
                    <TableCell>{d.source ? refLabel(d.source.image) : "Blank"}</TableCell>
                    <TableCell>
                      {d.storageConfig?.diskMode ?? "Standard"}
                      {d.storageConfig?.storageContainer && <span className="text-muted-foreground"> · {refLabel(d.storageConfig.storageContainer)}</span>}
                    </TableCell>
                    <TableCell>{obs ? <Copyable value={obs.extID} /> : <span className="text-muted-foreground text-xs">pending</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title="CD-ROM drives">
        {(vm.spec.storage?.cdroms ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">No CD-ROM drives declared.</p>
        ) : (
          <ul className="divide-y">
            {(vm.spec.storage?.cdroms ?? []).map((c) => (
              <li key={`${c.adapterType}.${c.deviceIndex}`} className="flex items-center gap-3 py-2">
                <Disc3 className="text-muted-foreground size-4" />
                <span className="font-mono text-sm">
                  {c.adapterType}.{c.deviceIndex}
                </span>
                <span className="text-sm">{c.image ? refLabel(c.image) : <span className="text-muted-foreground">Empty</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function NetworkTab({ vm }: { vm: VirtualMachine }) {
  const observed = new Map((vm.status?.nics ?? []).map((n) => [n.name, n]));
  const addrs = vm.status?.addresses ?? [];
  const assigned = new Set(addrs.filter((a) => a.source === "Assigned").map((a) => a.address));
  const learned = new Set(addrs.filter((a) => a.source === "Learned").map((a) => a.address));
  const mismatch = assigned.size > 0 && learned.size > 0 && [...assigned].some((a) => !learned.has(a));
  return (
    <div className="grid gap-5">
      <Section title="Network interfaces">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Subnet</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>MAC address</TableHead>
                <TableHead>NIC UUID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(vm.spec.network?.nics ?? []).map((n) => {
                const obs = observed.get(n.name);
                return (
                  <TableRow key={n.name}>
                    <TableCell className="font-medium">{n.name}</TableCell>
                    <TableCell>{refLabel(n.networkInfo?.subnet)}</TableCell>
                    <TableCell>{n.networkInfo?.nicType === "DIRECT_NIC" ? "Direct" : "Normal"}</TableCell>
                    <TableCell>
                      {obs?.macAddress ? <Copyable value={obs.macAddress} /> : <span className="text-muted-foreground text-xs">pending</span>}
                    </TableCell>
                    <TableCell>{obs ? <Copyable value={obs.extID} /> : <span className="text-muted-foreground text-xs">pending</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title="Addresses" description="Assigned by IPAM, configured as secondary, or learned from the guest">
        {mismatch && (
          <Alert className="border-warning/30 bg-warning/5 mb-4">
            <AlertTriangle className="text-warning" />
            <AlertDescription>The guest reports a different address than the one assigned by IPAM.</AlertDescription>
          </Alert>
        )}
        {addrs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No addresses reported yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {addrs.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <Copyable value={a.address} />
                <div className="flex gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {a.type}
                  </Badge>
                  {a.source && (
                    <Badge variant="secondary" className="text-[10px]">
                      {a.source}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Drift({ vm }: { vm: VirtualMachine }) {
  const qc = useQueryClient();
  const can = useCan();
  const ns = vm.metadata.namespace as string;
  const drift = vm.status?.drift ?? [];
  const policy = vm.spec.outOfBandDriftPolicy ?? "Report";
  const m = useMutation({
    mutationFn: () => {
      const next = structuredClone(vm);
      next.spec.outOfBandDriftPolicy = "Enforce";
      return unwrap(api.namespaces[":ns"].vms[":name"].$put({ param: { ns, name: vm.metadata.name as string }, query: {}, json: next }));
    },
    onSuccess: (v) => {
      qc.setQueryData(["vm", ns, vm.metadata.name], v);
      toast.success("Drift policy set to Enforce");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section
      title="Configuration drift"
      description={`Out-of-band changes made directly in Prism Central. Policy: ${policy}`}
      actions={
        drift.length > 0 && policy === "Report" ? (
          <Button size="sm" disabled={!can(ns, "virtualmachines", "update") || m.isPending} onClick={() => m.mutate()}>
            Enforce desired state
          </Button>
        ) : undefined
      }
    >
      {drift.length === 0 ? (
        <EmptyState title="No drift detected" description="The VM on Nutanix matches its declared configuration." className="py-8" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Desired</TableHead>
                <TableHead>Observed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drift.map((d) => (
                <TableRow key={d.path}>
                  <TableCell className="font-mono text-xs">{d.path}</TableCell>
                  <TableCell className="text-success font-mono text-xs">{d.desired}</TableCell>
                  <TableCell className="text-destructive font-mono text-xs">{d.observed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Section>
  );
}

function EventsTab({ ns, name }: { ns: string; name: string }) {
  const q = useQuery(vmEventsQuery(ns, name));
  return (
    <Section title="Events" description="Recent Kubernetes events emitted for this VM">
      {q.isLoading ? <LoadingState rows={4} /> : q.error ? <ErrorState error={q.error} /> : <EventList events={q.data ?? []} />}
    </Section>
  );
}

function ServicesTab({ ns, name }: { ns: string; name: string }) {
  const q = useQuery(vmServicesQuery(ns, name));
  return (
    <Section title="VM services" description="VirtualMachineServices whose selector matches this VM">
      {q.isLoading ? (
        <LoadingState rows={2} />
      ) : !q.data?.length ? (
        <EmptyState
          title="Not exposed by any service"
          className="py-8"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/services/new">Create service</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {q.data.map((svc) => (
            <li key={svc.metadata.name} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <Link to="/services/$ns/$name" params={{ ns, name: svc.metadata.name as string }} className="font-medium hover:underline">
                {svc.metadata.name}
              </Link>
              <div className="text-muted-foreground flex items-center gap-3 text-sm">
                <span>{svc.spec.type ?? "ClusterIP"}</span>
                <span>{svc.spec.ports.map((p) => p.port).join(", ")}</span>
                <span>
                  {svc.status?.readyEndpoints ?? 0}/{svc.status?.selectedVms ?? 0} ready
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function YamlTab({ vm }: { vm: VirtualMachine }) {
  const text = stringify(vm, { lineWidth: 0 });
  return (
    <Section
      title="Manifest"
      description="Live object from the Kubernetes API (read-only). Use Edit to change the VM."
      actions={
        <Button variant="outline" size="sm" onClick={() => downloadText(`${vm.metadata.name}.yaml`, text)}>
          Download
        </Button>
      }
    >
      <YamlEditor value={text} readOnly minHeight="400px" />
    </Section>
  );
}

function MetadataTab({ vm }: { vm: VirtualMachine }) {
  const qc = useQueryClient();
  const can = useCan();
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const [labels, setLabels] = useState<Record<string, string>>(vm.metadata.labels ?? {});
  const dirty = JSON.stringify(labels) !== JSON.stringify(vm.metadata.labels ?? {});
  const m = useMutation({
    mutationFn: () => {
      const patch: Record<string, string | null> = { ...labels };
      for (const k of Object.keys(vm.metadata.labels ?? {})) if (!(k in labels)) patch[k] = null;
      return unwrap(api.namespaces[":ns"].vms[":name"].metadata.$patch({ param: { ns, name }, json: { labels: patch } }));
    },
    onSuccess: (v) => {
      qc.setQueryData(["vm", ns, name], v);
      toast.success("Labels updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section
        title="Labels"
        description="Used by VM services selectors and for organization"
        actions={
          <Button size="sm" disabled={!dirty || m.isPending || !can(ns, "virtualmachines", "patch")} onClick={() => m.mutate()}>
            Save labels
          </Button>
        }
      >
        <KeyValueEditor value={labels} onChange={setLabels} addLabel="Add label" disabled={!can(ns, "virtualmachines", "patch")} />
      </Section>
      <Section title="Annotations">
        {Object.keys(vm.metadata.annotations ?? {}).length === 0 ? (
          <p className="text-muted-foreground text-sm">No annotations.</p>
        ) : (
          <dl className="grid gap-2">
            {Object.entries(vm.metadata.annotations ?? {}).map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-muted-foreground font-mono text-xs break-all">{k}</dt>
                <dd className="font-mono text-sm break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </div>
  );
}
