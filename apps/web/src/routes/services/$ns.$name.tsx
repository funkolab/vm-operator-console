import { getCondition, type VirtualMachineService } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Network, Pencil, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Copyable } from "@/components/copy-button";
import { DescriptionList, ErrorState, LoadingState, Page, PageHeader, Section } from "@/components/page";
import { ConditionList, ReadyBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ServiceForm } from "@/features/services/service-form";
import { api, errorMessage, unwrap } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { serviceQuery, useCan } from "@/lib/queries";

export const Route = createFileRoute("/services/$ns/$name")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(serviceQuery(params.ns, params.name)),
  pendingComponent: () => (
    <Page>
      <LoadingState />
    </Page>
  ),
  errorComponent: ({ error }) => (
    <Page>
      <ErrorState error={error} />
    </Page>
  ),
  component: ServiceDetailPage,
});

function ServiceDetailPage() {
  const { ns, name } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(serviceQuery(ns, name));
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState(false);
  const update = useMutation({
    mutationFn: (s: VirtualMachineService) => unwrap(api.namespaces[":ns"].services[":name"].$put({ param: { ns, name }, json: s })),
    onSuccess: () => {
      toast.success("Service updated");
      void qc.invalidateQueries({ queryKey: ["service", ns, name] });
      setEditing(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].services[":name"].$delete({ param: { ns, name } })),
    onSuccess: () => {
      toast.success(`Service ${name} deleted`);
      void qc.invalidateQueries({ queryKey: ["services"] });
      void navigate({ to: "/services" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const { service: svc, coreService, endpointSlices } = q.data;
  const ready = getCondition(svc.status?.conditions, "Ready");
  const lb = coreService?.status?.loadBalancer?.ingress?.map((i) => i.ip ?? i.hostname).filter(Boolean) as string[] | undefined;
  const endpoints = endpointSlices.flatMap((s) => s.endpoints ?? []);

  if (editing)
    return (
      <Page className="max-w-5xl">
        <PageHeader icon={<Pencil className="size-5" />} title={`Edit ${name}`} />
        <ServiceForm
          initial={svc}
          mode="edit"
          namespaces={[ns]}
          serverError={update.error}
          onSubmit={(s) => update.mutateAsync(s)}
          onCancel={() => setEditing(false)}
        />
      </Page>
    );

  return (
    <Page>
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-2">
          <Link to="/services">
            <ArrowLeft /> VM services
          </Link>
        </Button>
        <PageHeader
          icon={<Network className="size-5" />}
          title={
            <span className="flex items-center gap-2">
              {name} <ReadyBadge status={ready?.status} reason={ready?.reason} />
            </span>
          }
          description={<span className="font-mono">{ns}</span>}
          actions={
            <>
              <Button variant="outline" size="sm" disabled={!can(ns, "virtualmachineservices", "update")} onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!can(ns, "virtualmachineservices", "delete")}
                onClick={() => setDel(true)}
              >
                <Trash2 /> Delete
              </Button>
            </>
          }
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Access">
          <DescriptionList
            items={[
              { label: "DNS name", value: <Copyable value={`${svc.status?.serviceRef?.name ?? name}.${ns}.svc.cluster.local`} /> },
              { label: "Type", value: `${svc.spec.type ?? "ClusterIP"}${svc.spec.headless ? " (headless)" : ""}` },
              { label: "Cluster IP", value: <Copyable value={coreService?.spec?.clusterIP} /> },
              {
                label: "External address",
                value: lb?.length ? lb.join(", ") : svc.spec.type === "LoadBalancer" ? "Pending" : "—",
                hidden: svc.spec.type !== "LoadBalancer",
              },
              {
                label: "Ports",
                value: svc.spec.ports.map((p) => `${p.name ? `${p.name}: ` : ""}${p.port}→${p.targetPort ?? p.port}/${p.protocol ?? "TCP"}`).join(", "),
              },
              {
                label: "Selector",
                value: (
                  <span className="font-mono text-xs">
                    {Object.entries(svc.spec.selector.matchLabels ?? {})
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ") || "(all VMs)"}
                  </span>
                ),
              },
              { label: "Serving", value: `${svc.status?.readyEndpoints ?? 0} of ${svc.status?.selectedVms ?? 0} selected VM(s)` },
              { label: "Last sync", value: relativeTime(svc.status?.lastEndpointSyncTime) },
              {
                label: "Probing",
                value: svc.spec.endpointProbe?.enabled
                  ? `TCP, timeout ${svc.spec.endpointProbe.dialTimeout ?? "2s"}, threshold ${svc.spec.endpointProbe.demoteThreshold ?? 3}`
                  : "Disabled",
              },
            ]}
          />
        </Section>
        <Section title="Conditions">
          <ConditionList conditions={svc.status?.conditions} order={["Ready", "EndpointsResolved", "ProbesDegraded"]} />
        </Section>
        <Section title="Endpoints" className="lg:col-span-2" description="From the operator-owned EndpointSlice">
          {endpoints.length === 0 ? (
            <p className="text-muted-foreground text-sm">No endpoints programmed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VM</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Ready</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((e) => (
                  <TableRow key={e.addresses.join(",")}>
                    <TableCell>
                      {e.targetRef?.name ? (
                        <Link to="/vms/$ns/$name" params={{ ns, name: e.targetRef.name }} className="hover:underline">
                          {e.targetRef.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{e.addresses.join(", ")}</TableCell>
                    <TableCell>
                      {e.conditions?.ready !== false ? (
                        <Badge variant="outline" className="text-success border-success/30 gap-1">
                          <CheckCircle2 className="size-3" /> Ready
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive border-destructive/30 gap-1">
                          <XCircle className="size-3" /> Not ready
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        destructive
        title={`Delete service ${name}?`}
        description="Clients using this DNS name will lose connectivity. The VMs are not affected."
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync()}
      />
    </Page>
  );
}
