import { getCondition } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, ServerCog } from "lucide-react";
import { useMemo } from "react";
import { ButtonLink } from "@/components/button-link";
import { DataTable, SortHeader } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { ReadyBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { age } from "@/lib/format";
import { useNamespace } from "@/lib/namespace";
import { contextsQuery, useNamespacesWith } from "@/lib/queries";

export const Route = createFileRoute("/contexts/")({ component: ContextsPage });

type Ctx = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof contextsQuery>["queryFn"]>>>>[number];

function ContextsPage() {
  const ns = useNamespace();
  const navigate = useNavigate();
  const q = useQuery(contextsQuery(ns));
  const creatable = useNamespacesWith("nutanixprismcontexts", "create");
  const columns = useMemo<ColumnDef<Ctx, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (c) => c.metadata.name,
        header: ({ column }) => <SortHeader label="Name" column={column} />,
        cell: ({ row: { original: c } }) => (
          <Link
            to="/contexts/$ns/$name"
            params={{ ns: c.metadata.namespace as string, name: c.metadata.name as string }}
            className="font-medium hover:underline"
          >
            {c.metadata.name}
          </Link>
        ),
      },
      { id: "namespace", accessorFn: (c) => c.metadata.namespace, header: ({ column }) => <SortHeader label="Namespace" column={column} /> },
      {
        id: "connected",
        accessorFn: (c) => getCondition(c.status?.conditions, "Connected")?.status ?? "Unknown",
        header: "Connection",
        cell: ({ row: { original: c } }) => {
          const cd = getCondition(c.status?.conditions, "Connected");
          return <ReadyBadge status={cd?.status} reason={cd?.status === "True" ? "Connected" : (cd?.reason ?? "Unknown")} />;
        },
      },
      {
        id: "endpoint",
        accessorFn: (c) => c.spec.endpoint.address,
        header: "Endpoint",
        cell: ({ row: { original: c } }) => (
          <span className="font-mono text-sm">
            {c.spec.endpoint.address}:{c.spec.endpoint.port ?? 9440}
            {c.spec.endpoint.tls.mode === "Insecure" && (
              <Badge variant="outline" className="text-warning border-warning/40 ml-2 text-[10px]">
                insecure
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: "version",
        accessorFn: (c) => c.status?.pcVersion ?? "",
        header: "PC version",
        cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">—</span>,
      },
      {
        id: "project",
        accessorFn: (c) => c.status?.project?.name ?? c.spec.project?.name ?? "",
        header: "Project",
        cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">default</span>,
      },
      { id: "vms", accessorFn: (c) => c.vmCount ?? 0, header: ({ column }) => <SortHeader label="VMs" column={column} /> },
      {
        id: "age",
        accessorFn: (c) => c.metadata.creationTimestamp ?? "",
        header: "Age",
        cell: ({ row: { original: c } }) => <span className="text-muted-foreground">{age(c.metadata.creationTimestamp)}</span>,
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="Prism Central"
        icon={<ServerCog className="size-5" />}
        description="Prism Central accounts (NutanixPrismContext + credential Secret) used by VMs to reach Nutanix."
        actions={
          <ButtonLink disabled={!creatable.length} to="/contexts/new">
            <Plus /> Add account
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
          getRowId={(c) => `${c.metadata.namespace}/${c.metadata.name}`}
          onRowClick={(c) => navigate({ to: "/contexts/$ns/$name", params: { ns: c.metadata.namespace as string, name: c.metadata.name as string } })}
          emptyState={
            <EmptyState
              icon={<ServerCog className="size-6" />}
              title="No Prism Central account"
              description="Add a Prism Central endpoint and credentials so VMs in this namespace can be provisioned."
              action={
                creatable.length ? (
                  <Button asChild>
                    <Link to="/contexts/new">
                      <Plus /> Add account
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
