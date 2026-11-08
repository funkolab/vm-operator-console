import { formatBytes, summarizeVM, type VirtualMachine, VM_PHASES, type VMSummary } from "@console/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, LayoutTemplate, Pause, Play, Plus, RotateCcw, Server, Square, Tag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyButton } from "@/components/copy-button";
import { DataTable, facetFilterFn, SortHeader, selectColumn } from "@/components/data-table";
import { KeyValueEditor } from "@/components/form";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { PausedBadge, PhaseBadge, PowerIcon } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VMActions } from "@/features/vms/actions";
import { api, errorMessage, unwrap } from "@/lib/api";
import { age } from "@/lib/format";
import { ALL, useNamespace } from "@/lib/namespace";
import { useCan, useNamespacesWith, vmsQuery } from "@/lib/queries";

const Search = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/vms/")({
  validateSearch: Search,
  component: VMListPage,
});

type Row = VMSummary & { vm: VirtualMachine };

function VMListPage() {
  const ns = useNamespace();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const can = useCan();
  const creatable = useNamespacesWith("virtualmachines", "create");
  const q = useQuery(vmsQuery(ns));
  const rows = useMemo<Row[]>(() => (q.data ?? []).map((vm) => ({ ...summarizeVM(vm), vm })), [q.data]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      selectColumn<Row>(),
      {
        id: "name",
        accessorFn: (r) => r.displayName,
        meta: { label: "Name" },
        enableHiding: false,
        header: ({ column }) => <SortHeader label="Name" column={column} />,
        cell: ({ row: { original: r } }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <PowerIcon observed={r.powerState} desired={r.desiredPowerState} />
            <div className="min-w-0">
              <Link to="/vms/$ns/$name" params={{ ns: r.namespace, name: r.name }} className="block truncate font-medium hover:underline">
                {r.displayName}
              </Link>
              {r.displayName !== r.name && <div className="text-muted-foreground truncate font-mono text-xs">{r.name}</div>}
            </div>
            {r.paused && <PausedBadge />}
          </div>
        ),
      },
      {
        id: "namespace",
        accessorKey: "namespace",
        meta: { label: "Namespace" },
        header: ({ column }) => <SortHeader label="Namespace" column={column} />,
        filterFn: facetFilterFn,
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span>,
      },
      {
        id: "phase",
        accessorKey: "phase",
        meta: { label: "Status" },
        header: ({ column }) => <SortHeader label="Status" column={column} />,
        filterFn: facetFilterFn,
        cell: ({ row: { original: r } }) => (
          <div className="flex items-center gap-1.5">
            <PhaseBadge phase={r.phase} title={r.ready !== "True" ? [r.readyReason, r.readyMessage].filter(Boolean).join(": ") : undefined} />
            {r.driftCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="text-warning size-4" />
                </TooltipTrigger>
                <TooltipContent>{r.driftCount} field(s) drifted from the desired state</TooltipContent>
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        id: "ip",
        accessorFn: (r) => r.primaryIP ?? "",
        meta: { label: "IP address" },
        header: ({ column }) => <SortHeader label="IP address" column={column} />,
        cell: ({ row: { original: r } }) =>
          r.primaryIP ? (
            <span className="inline-flex items-center gap-1 font-mono text-[0.8125rem]">
              {r.primaryIP}
              <CopyButton value={r.primaryIP} />
              {r.ipAddresses.length > 1 && <span className="text-muted-foreground text-xs">+{r.ipAddresses.length - 1}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "cluster",
        accessorKey: "cluster",
        meta: { label: "Cluster" },
        header: ({ column }) => <SortHeader label="Cluster" column={column} />,
        filterFn: facetFilterFn,
      },
      {
        id: "vcpus",
        accessorKey: "vcpus",
        meta: { label: "vCPU" },
        header: ({ column }) => <SortHeader label="vCPU" column={column} />,
        cell: ({ getValue }) => <span className="tabular">{getValue() as number}</span>,
      },
      {
        id: "memory",
        accessorKey: "memoryBytes",
        meta: { label: "Memory" },
        header: ({ column }) => <SortHeader label="Memory" column={column} />,
        cell: ({ getValue }) => <span className="tabular">{formatBytes(getValue() as number)}</span>,
      },
      {
        id: "storage",
        accessorKey: "diskBytes",
        meta: { label: "Storage" },
        header: ({ column }) => <SortHeader label="Storage" column={column} />,
        cell: ({ row: { original: r } }) => (
          <span className="tabular">
            {r.diskBytes ? formatBytes(r.diskBytes) : "—"} <span className="text-muted-foreground text-xs">({r.diskCount})</span>
          </span>
        ),
      },
      {
        id: "context",
        accessorFn: (r) => r.context ?? "",
        meta: { label: "Prism Central" },
        header: ({ column }) => <SortHeader label="Prism Central" column={column} />,
        filterFn: facetFilterFn,
      },
      {
        id: "template",
        accessorFn: (r) => r.template ?? "",
        meta: { label: "Template" },
        header: "Template",
        filterFn: facetFilterFn,
        cell: ({ row: { original: r } }) =>
          r.template ? (
            <Link
              to="/templates/$ns/$name"
              params={{ ns: r.namespace, name: r.template }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
            >
              <LayoutTemplate className="size-3.5" /> {r.template}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "labels",
        accessorFn: (r) =>
          Object.entries(r.labels)
            .map(([k, v]) => `${k}=${v}`)
            .join(" "),
        meta: { label: "Labels" },
        header: "Labels",
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <div className="flex max-w-64 flex-wrap gap-1">
            {Object.entries(r.labels)
              .filter(([k]) => !k.includes("console.nutanix.com"))
              .slice(0, 3)
              .map(([k, v]) => (
                <Badge key={k} variant="secondary" className="max-w-full truncate font-mono text-[11px] font-normal">
                  {k}={v}
                </Badge>
              ))}
          </div>
        ),
      },
      {
        id: "age",
        accessorFn: (r) => r.createdAt ?? "",
        meta: { label: "Age" },
        header: ({ column }) => <SortHeader label="Age" column={column} />,
        sortingFn: (a, b) => (b.original.createdAt ?? "").localeCompare(a.original.createdAt ?? ""),
        cell: ({ row: { original: r } }) => <span className="text-muted-foreground tabular">{age(r.createdAt)}</span>,
      },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: r } }) => <VMActions vm={r.vm} />,
      },
    ],
    [],
  );

  const presentPhases = new Set(rows.map((r) => r.phase));

  return (
    <Page>
      <PageHeader
        title="Virtual machines"
        icon={<Server className="size-5" />}
        description={ns === ALL ? "All namespaces you can access" : `Namespace ${ns}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/templates">
                <LayoutTemplate /> From template
              </Link>
            </Button>
            <ButtonLink disabled={!creatable.length} to="/vms/new">
              <Plus /> Create VM
            </ButtonLink>
          </>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(r) => r.key}
          storageKey="vms.table"
          initialSorting={[{ id: "name", desc: false }]}
          initialSearch={search.q ?? ""}
          onSearchChange={(v) => navigate({ to: ".", search: { q: v || undefined }, replace: true })}
          searchPlaceholder="Search name, IP, label…"
          globalFilterFn={(r, s) =>
            r.name.includes(s) ||
            r.displayName.toLowerCase().includes(s) ||
            r.ipAddresses.some((ip) => ip.includes(s)) ||
            r.cluster.toLowerCase().includes(s) ||
            r.namespace.includes(s) ||
            Object.entries(r.labels).some(([k, v]) => `${k}=${v}`.toLowerCase().includes(s))
          }
          facets={[
            { columnId: "phase", title: "Status", options: VM_PHASES.filter((p) => presentPhases.has(p)).map((p) => ({ value: p })) },
            ...(ns === ALL ? [{ columnId: "namespace", title: "Namespace" }] : []),
            { columnId: "cluster", title: "Cluster" },
            { columnId: "context", title: "Prism Central" },
          ]}
          onRowClick={(r) => navigate({ to: "/vms/$ns/$name", params: { ns: r.namespace, name: r.name } })}
          renderMobileCard={(r, selected, toggle) => (
            <div className="bg-card flex items-start gap-3 rounded-xl border p-3">
              <Checkbox checked={selected} onCheckedChange={toggle} className="mt-1" aria-label="Select" />
              <Link to="/vms/$ns/$name" params={{ ns: r.namespace, name: r.name }} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <PowerIcon observed={r.powerState} desired={r.desiredPowerState} />
                  <span className="truncate font-medium">{r.displayName}</span>
                </div>
                <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{r.namespace}</span>
                  <span>{r.vcpus} vCPU</span>
                  <span>{formatBytes(r.memoryBytes)}</span>
                  {r.primaryIP && <span className="font-mono">{r.primaryIP}</span>}
                </div>
                <div className="mt-2">
                  <PhaseBadge phase={r.phase} />
                </div>
              </Link>
              <VMActions vm={r.vm} />
            </div>
          )}
          bulkActions={(sel, clear) => <BulkActions rows={sel} clear={clear} can={can} />}
          emptyState={
            <EmptyState
              icon={<Server className="size-6" />}
              title="No virtual machines yet"
              description="Create a VM from scratch or deploy one from a template."
              action={
                creatable.length ? (
                  <div className="flex gap-2">
                    <Button asChild variant="outline">
                      <Link to="/templates">Browse templates</Link>
                    </Button>
                    <Button asChild>
                      <Link to="/vms/new">
                        <Plus /> Create VM
                      </Link>
                    </Button>
                  </div>
                ) : undefined
              }
            />
          }
        />
      )}
    </Page>
  );
}

function BulkActions({ rows, clear, can }: { rows: Row[]; clear: () => void; can: ReturnType<typeof useCan> }) {
  const [confirm, setConfirm] = useState<null | "delete" | "stop" | "restart">(null);
  const [labels, setLabels] = useState(false);
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});
  const allowed = (verb: "patch" | "delete") => rows.every((r) => can(r.namespace, "virtualmachines", verb));
  const m = useMutation({
    mutationFn: (body: { action: "start" | "stop" | "restart" | "pause" | "resume" | "delete" | "label"; labels?: Record<string, string | null> }) =>
      unwrap(api.vms.bulk.$post({ json: { ...body, targets: rows.map((r) => ({ namespace: r.namespace, name: r.name })) } })),
    onSuccess: (res, v) => {
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length) toast.error(`${failed.length} of ${res.results.length} failed: ${failed[0]?.error}`);
      else toast.success(`${v.action} requested for ${res.results.length} VM(s)`);
      clear();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button size="sm" variant="outline" disabled={!allowed("patch")} onClick={() => m.mutate({ action: "start" })}>
        <Play /> Power on
      </Button>
      <Button size="sm" variant="outline" disabled={!allowed("patch")} onClick={() => setConfirm("stop")}>
        <Square /> Power off
      </Button>
      <Button size="sm" variant="outline" disabled={!allowed("patch")} onClick={() => setConfirm("restart")}>
        <RotateCcw /> Restart
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={!allowed("patch")}>
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setLabels(true)}>
            <Tag /> Edit labels
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => m.mutate({ action: "pause" })}>
            <Pause /> Pause reconciliation
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => m.mutate({ action: "resume" })}>
            <Play /> Resume reconciliation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="outline" className="text-destructive" disabled={!allowed("delete")} onClick={() => setConfirm("delete")}>
        <Trash2 /> Delete
      </Button>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        destructive={confirm === "delete"}
        title={confirm === "delete" ? `Delete ${rows.length} VM(s)?` : confirm === "stop" ? `Power off ${rows.length} VM(s)?` : `Restart ${rows.length} VM(s)?`}
        typeToConfirm={confirm === "delete" ? `delete ${rows.length}` : undefined}
        confirmLabel={confirm === "delete" ? "Delete" : confirm === "stop" ? "Power off" : "Restart"}
        description={
          <div className="max-h-40 overflow-auto font-mono text-xs">
            {rows.map((r) => (
              <div key={r.key}>{r.key}</div>
            ))}
          </div>
        }
        onConfirm={() => m.mutateAsync({ action: confirm as "delete" })}
      />
      <Dialog open={labels} onOpenChange={setLabels}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add or update labels on {rows.length} VM(s)</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">Leave a value empty to remove that label.</p>
          <KeyValueEditor value={labelMap} onChange={setLabelMap} addLabel="Add label" />
          <DialogFooter>
            <Button
              disabled={!Object.keys(labelMap).length}
              onClick={async () => {
                await m.mutateAsync({ action: "label", labels: Object.fromEntries(Object.entries(labelMap).map(([k, v]) => [k, v === "" ? null : v])) });
                setLabels(false);
                setLabelMap({});
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
