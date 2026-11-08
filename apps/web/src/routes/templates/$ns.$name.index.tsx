import { formatQuantity, refLabel, summarizeVM, vmVCPUs } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, Pencil, Rocket } from "lucide-react";
import { useState } from "react";
import { stringify } from "yaml";
import { ButtonLink } from "@/components/button-link";
import { YamlEditor } from "@/components/lazy";
import { DescriptionList, EmptyState, ErrorState, LoadingState, Page, PageHeader, Section } from "@/components/page";
import { PhaseBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeployDialog } from "@/features/templates/deploy-dialog";
import { DuplicateDialog } from "@/features/templates/duplicate-dialog";
import { templateExportYaml } from "@/features/templates/export";
import { OsIcon } from "@/features/templates/os-icon";
import { downloadText, formatDate, relativeTime } from "@/lib/format";
import { templateQuery, templateVMsQuery, useCan } from "@/lib/queries";

export const Route = createFileRoute("/templates/$ns/$name/")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(templateQuery(params.ns, params.name)),
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
  component: TemplateDetailPage,
});

function TemplateDetailPage() {
  const { ns, name } = Route.useParams();
  const can = useCan();
  const q = useQuery(templateQuery(ns, name));
  const vms = useQuery(templateVMsQuery(ns, name));
  const [deploy, setDeploy] = useState(false);
  const [dup, setDup] = useState(false);
  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const t = q.data;
  const spec = t.vm.spec;
  return (
    <Page>
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-2">
          <Link to="/templates">
            <ArrowLeft /> Templates
          </Link>
        </Button>
        <PageHeader
          icon={<OsIcon os={t.osType} />}
          title={t.displayName}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">
                {ns}/{name}
              </span>
              {t.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </span>
          }
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => downloadText(`${name}.template.yaml`, templateExportYaml(t))}>
                <Download /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDup(true)}>
                <Copy /> Duplicate
              </Button>
              <ButtonLink variant="outline" size="sm" disabled={!can(ns, "configmaps", "update")} to="/templates/$ns/$name/edit" params={{ ns, name }}>
                <Pencil /> Edit
              </ButtonLink>
              <Button size="sm" disabled={!can(ns, "virtualmachines", "create")} onClick={() => setDeploy(true)}>
                <Rocket /> Deploy
              </Button>
            </>
          }
        />
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vms">VMs ({vms.data?.length ?? t.usageCount ?? 0})</TabsTrigger>
          <TabsTrigger value="yaml">Manifest</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4 grid gap-5 lg:grid-cols-2">
          <Section title="Configuration">
            {t.description && <p className="text-muted-foreground mb-4 text-sm">{t.description}</p>}
            <DescriptionList
              items={[
                { label: "Size", value: `${vmVCPUs({ spec } as never)} vCPU · ${formatQuantity(spec.compute?.memorySize)}` },
                { label: "Cluster", value: refLabel(spec.placement?.cluster) },
                { label: "Boot image", value: refLabel(spec.bootConfiguration?.bootDisk?.source?.image) },
                {
                  label: "Boot disk",
                  value: spec.bootConfiguration?.bootDisk?.diskSize ? formatQuantity(spec.bootConfiguration.bootDisk.diskSize) : "Image size",
                },
                { label: "Firmware", value: spec.bootConfiguration?.bootType?.toUpperCase() ?? "Default" },
                {
                  label: "Data disks",
                  value: spec.storage?.dataDisks?.length ? spec.storage.dataDisks.map((d) => formatQuantity(d.diskSize)).join(", ") : "None",
                },
                { label: "Network", value: (spec.network?.nics ?? []).map((n) => `${n.name}: ${refLabel(n.networkInfo?.subnet)}`).join(", ") || "None" },
                {
                  label: "Customization",
                  value: spec.guestCustomization
                    ? `${spec.guestCustomization.type}${spec.guestCustomization.secretRef ? ` (${spec.guestCustomization.secretRef.name})` : ""}`
                    : "None",
                },
                { label: "Prism Central", value: spec.context?.name ?? "Automatic" },
                { label: "Created", value: `${formatDate(t.createdAt)}${t.createdBy ? ` by ${t.createdBy}` : ""}` },
                { label: "Last updated by", value: t.updatedBy ?? "—", hidden: !t.updatedBy },
              ]}
            />
          </Section>
          <Section title="Deploy-time parameters" description={t.parameters.length ? undefined : "VMs are deployed exactly as defined"}>
            {t.parameters.length === 0 ? (
              <p className="text-muted-foreground text-sm">No parameters.</p>
            ) : (
              <ul className="divide-y">
                {t.parameters.map((p) => (
                  <li key={p.name} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {p.label || p.name} {p.required && <span className="text-destructive">*</span>}
                      </div>
                      <div className="text-muted-foreground font-mono text-xs">{p.path}</div>
                      {p.description && <div className="text-muted-foreground text-xs">{p.description}</div>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline">{p.type}</Badge>
                      {p.default !== undefined && (
                        <span className="text-muted-foreground text-xs">
                          default {typeof p.default === "object" ? refLabel(p.default as never) : String(p.default)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="vms" className="mt-4">
          <Section title="VMs deployed from this template">
            {vms.isLoading ? (
              <LoadingState rows={3} />
            ) : !vms.data?.length ? (
              <EmptyState
                title="No VMs yet"
                className="py-8"
                action={
                  <Button size="sm" onClick={() => setDeploy(true)}>
                    <Rocket /> Deploy
                  </Button>
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vms.data.map((vm) => {
                    const s = summarizeVM(vm);
                    return (
                      <TableRow key={s.key}>
                        <TableCell>
                          <Link to="/vms/$ns/$name" params={{ ns: s.namespace, name: s.name }} className="font-medium hover:underline">
                            {s.displayName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <PhaseBadge phase={s.phase} />
                        </TableCell>
                        <TableCell className="font-mono text-sm">{s.primaryIP ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{relativeTime(s.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="yaml" className="mt-4">
          <Section title="VirtualMachine manifest" description={`Stored in ConfigMap vmt-${name}`}>
            <YamlEditor value={stringify(t.vm, { lineWidth: 0 })} readOnly minHeight="360px" />
          </Section>
        </TabsContent>
      </Tabs>
      {deploy && <DeployDialog template={t} open={deploy} onOpenChange={setDeploy} />}
      {dup && <DuplicateDialog template={t} open={dup} onOpenChange={setDup} />}
    </Page>
  );
}
