import { GUEST_SCRIPT_LABELS, type GuestScriptSummary } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { FileCode2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable, facetFilterFn, SortHeader } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewScriptDialog } from "@/features/guest-scripts/new-script-dialog";
import { relativeTime } from "@/lib/format";
import { ALL, useNamespace } from "@/lib/namespace";
import { guestSecretsQuery, useNamespacesWith } from "@/lib/queries";

export const Route = createFileRoute("/guest-scripts/")({ component: GuestScriptsPage });

export function EngineBadge({ type }: { type: GuestScriptSummary["type"] }) {
  return (
    <Badge variant="outline" className="font-normal">
      {GUEST_SCRIPT_LABELS[type]}
      <span className="text-muted-foreground">{type === "CloudInit" ? "Linux" : "Windows"}</span>
    </Badge>
  );
}

const formatSize = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KiB`);

function GuestScriptsPage() {
  const scope = useNamespace();
  const navigate = useNavigate();
  const q = useQuery(guestSecretsQuery(scope));
  const creatable = useNamespacesWith("secrets", "create");
  const [dialog, setDialog] = useState(false);
  const open = (s: GuestScriptSummary) => navigate({ to: "/guest-scripts/$ns/$name", params: { ns: s.namespace, name: s.name } });

  const columns = useMemo<ColumnDef<GuestScriptSummary, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (s) => s.name,
        header: ({ column }) => <SortHeader label="Name" column={column} />,
        cell: ({ row: { original: s } }) => (
          <div className="min-w-0">
            <Link to="/guest-scripts/$ns/$name" params={{ ns: s.namespace, name: s.name }} className="font-medium hover:underline">
              {s.name}
            </Link>
            {s.description && <div className="text-muted-foreground max-w-md truncate text-xs">{s.description}</div>}
          </div>
        ),
      },
      { id: "namespace", accessorFn: (s) => s.namespace, header: ({ column }) => <SortHeader label="Namespace" column={column} /> },
      {
        id: "type",
        accessorFn: (s) => s.type,
        header: "Engine",
        cell: ({ row: { original: s } }) => <EngineBadge type={s.type} />,
        filterFn: facetFilterFn,
      },
      {
        id: "usage",
        accessorFn: (s) => s.usage.vms + s.usage.templates,
        header: ({ column }) => <SortHeader label="Used by" column={column} />,
        cell: ({ row: { original: s } }) =>
          s.usage.vms + s.usage.templates === 0 ? (
            <span className="text-muted-foreground">Unused</span>
          ) : (
            <span className="tabular">
              {[
                s.usage.vms && `${s.usage.vms} VM${s.usage.vms > 1 ? "s" : ""}`,
                s.usage.templates && `${s.usage.templates} template${s.usage.templates > 1 ? "s" : ""}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ),
      },
      {
        id: "size",
        accessorFn: (s) => s.sizeBytes,
        header: "Size",
        cell: ({ row: { original: s } }) => <span className="tabular">{formatSize(s.sizeBytes)}</span>,
      },
      {
        id: "updated",
        accessorFn: (s) => s.updatedAt ?? "",
        header: ({ column }) => <SortHeader label="Updated" column={column} />,
        cell: ({ row: { original: s } }) => (
          <span className="text-muted-foreground">
            {relativeTime(s.updatedAt)}
            {s.updatedBy && ` by ${s.updatedBy}`}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="Guest scripts"
        icon={<FileCode2 className="size-5" />}
        description="Cloud-init (Linux) and Sysprep (Windows) scripts applied at first boot. VMs and templates reference them by name from their namespace."
        actions={
          <Button disabled={!creatable.length} onClick={() => setDialog(true)}>
            <Plus /> New script
          </Button>
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
          getRowId={(s) => `${s.namespace}/${s.name}`}
          facets={[
            {
              columnId: "type",
              title: "Engine",
              options: [
                { value: "CloudInit", label: "Cloud-init" },
                { value: "Sysprep", label: "Sysprep" },
              ],
            },
          ]}
          searchPlaceholder="Search scripts…"
          globalFilterFn={(s, query) => `${s.name} ${s.namespace} ${s.description ?? ""}`.toLowerCase().includes(query.toLowerCase())}
          storageKey="guest-scripts"
          onRowClick={open}
          emptyState={
            <EmptyState
              icon={<FileCode2 className="size-6" />}
              title="No guest script yet"
              description="Create a cloud-init or Sysprep script once, then reuse it in every VM and template of the namespace."
              action={
                creatable.length ? (
                  <Button onClick={() => setDialog(true)}>
                    <Plus /> New script
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      {dialog && (
        <NewScriptDialog
          open={dialog}
          onOpenChange={setDialog}
          namespace={scope !== ALL && creatable.includes(scope) ? scope : (creatable[0] ?? "")}
          namespaces={creatable}
          onCreated={(s) => navigate({ to: "/guest-scripts/$ns/$name", params: { ns: s.namespace, name: s.name } })}
        />
      )}
    </Page>
  );
}
