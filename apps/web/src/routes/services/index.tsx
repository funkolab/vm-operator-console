import { getCondition } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Network, Plus } from "lucide-react";
import { useMemo } from "react";
import { ButtonLink } from "@/components/button-link";
import { DataTable, SortHeader } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { ReadyBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { age } from "@/lib/format";
import { useNamespace } from "@/lib/namespace";
import { servicesQuery, useNamespacesWith } from "@/lib/queries";

export const Route = createFileRoute("/services/")({ component: ServicesPage });

type Svc = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof servicesQuery>["queryFn"]>>>>[number];

function ServicesPage() {
  const ns = useNamespace();
  const navigate = useNavigate();
  const q = useQuery(servicesQuery(ns));
  const creatable = useNamespacesWith("virtualmachineservices", "create");
  const columns = useMemo<ColumnDef<Svc, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (s) => s.metadata.name,
        header: ({ column }) => <SortHeader label="Name" column={column} />,
        cell: ({ row: { original: s } }) => (
          <Link
            to="/services/$ns/$name"
            params={{ ns: s.metadata.namespace as string, name: s.metadata.name as string }}
            className="font-medium hover:underline"
          >
            {s.metadata.name}
          </Link>
        ),
      },
      { id: "namespace", accessorFn: (s) => s.metadata.namespace, header: ({ column }) => <SortHeader label="Namespace" column={column} /> },
      {
        id: "ready",
        accessorFn: (s) => getCondition(s.status?.conditions, "Ready")?.status ?? "Unknown",
        header: "Status",
        cell: ({ row: { original: s } }) => {
          const r = getCondition(s.status?.conditions, "Ready");
          return <ReadyBadge status={r?.status} reason={r?.reason} />;
        },
      },
      { id: "type", accessorFn: (s) => `${s.spec.type ?? "ClusterIP"}${s.spec.headless ? " (headless)" : ""}`, header: "Type" },
      {
        id: "ports",
        accessorFn: (s) => s.spec.ports.map((p) => p.port).join(","),
        header: "Ports",
        cell: ({ row: { original: s } }) => (
          <div className="flex flex-wrap gap-1">
            {s.spec.ports.map((p) => (
              <Badge key={`${p.name}${p.port}`} variant="secondary" className="font-mono text-[11px]">
                {p.port}
                {p.targetPort && p.targetPort !== p.port ? `→${p.targetPort}` : ""}/{p.protocol ?? "TCP"}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "endpoints",
        accessorFn: (s) => s.status?.readyEndpoints ?? 0,
        header: ({ column }) => <SortHeader label="Endpoints" column={column} />,
        cell: ({ row: { original: s } }) => (
          <span className="tabular">
            {s.status?.readyEndpoints ?? 0} / {s.status?.selectedVms ?? 0}
          </span>
        ),
      },
      {
        id: "selector",
        accessorFn: (s) =>
          Object.entries(s.spec.selector.matchLabels ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join(","),
        header: "Selector",
        cell: ({ getValue }) => <span className="text-muted-foreground font-mono text-xs">{getValue() as string}</span>,
      },
      {
        id: "age",
        accessorFn: (s) => s.metadata.creationTimestamp ?? "",
        header: "Age",
        cell: ({ row: { original: s } }) => <span className="text-muted-foreground">{age(s.metadata.creationTimestamp)}</span>,
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="VM services"
        icon={<Network className="size-5" />}
        description="Stable in-cluster endpoints (ClusterIP, headless or LoadBalancer) in front of VMs selected by label."
        actions={
          <ButtonLink disabled={!creatable.length} to="/services/new">
            <Plus /> Create service
          </ButtonLink>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          data={q.data ?? []}
          columns={columns}
          getRowId={(s) => `${s.metadata.namespace}/${s.metadata.name}`}
          onRowClick={(s) => navigate({ to: "/services/$ns/$name", params: { ns: s.metadata.namespace as string, name: s.metadata.name as string } })}
          emptyState={
            <EmptyState
              icon={<Network className="size-6" />}
              title="No VM services"
              description="Expose a group of VMs to pods in the cluster behind a single DNS name."
              action={
                creatable.length ? (
                  <Button asChild>
                    <Link to="/services/new">
                      <Plus /> Create service
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
    </Page>
  );
}
