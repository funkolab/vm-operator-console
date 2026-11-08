import { formatQuantity, refLabel, vmVCPUs } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Copy, Download, LayoutGrid, LayoutTemplate, List, MoreHorizontal, Pencil, Plus, Rocket, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parse } from "yaml";
import { z } from "zod";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, SortHeader } from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DeployDialog } from "@/features/templates/deploy-dialog";
import { DuplicateDialog } from "@/features/templates/duplicate-dialog";
import { templateExportYaml } from "@/features/templates/export";
import { OsIcon } from "@/features/templates/os-icon";
import { api, errorMessage, unwrap } from "@/lib/api";
import { downloadText, relativeTime } from "@/lib/format";
import { ALL, useNamespace } from "@/lib/namespace";
import { templatesQuery, useCan, useNamespacesWith } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/templates/")({
  validateSearch: z.object({ q: z.string().optional(), tag: z.string().optional() }),
  component: TemplatesPage,
});

type Template = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof templatesQuery>["queryFn"]>>>>[number];

function TemplateMenu({ t, onDeploy }: { t: Template; onDeploy: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const [del, setDel] = useState(false);
  const [dup, setDup] = useState(false);
  const m = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].templates[":name"].$delete({ param: { ns: t.namespace, name: t.name } })),
    onSuccess: () => {
      toast.success(`Template ${t.displayName} deleted`);
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${t.displayName}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem disabled={!!t.invalid || !can(t.namespace, "virtualmachines", "create")} onSelect={onDeploy}>
            <Rocket /> Deploy
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!can(t.namespace, "configmaps", "update")}>
            <Link to="/templates/$ns/$name/edit" params={{ ns: t.namespace, name: t.name }}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!t.invalid} onSelect={() => setDup(true)}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadText(`${t.name}.template.yaml`, templateExportYaml(t))}>
            <Download /> Export YAML
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!can(t.namespace, "configmaps", "delete")} onSelect={() => setDel(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        destructive
        title={`Delete template ${t.displayName}?`}
        description={`VMs already deployed from this template are not affected.${t.usageCount ? ` ${t.usageCount} VM(s) reference it.` : ""}`}
        confirmLabel="Delete template"
        onConfirm={() => m.mutateAsync()}
      />
      {dup && <DuplicateDialog template={t} open={dup} onOpenChange={setDup} />}
    </>
  );
}

function TemplateCard({ t, onDeploy }: { t: Template; onDeploy: () => void }) {
  const can = useCan();
  const spec = t.vm.spec;
  return (
    <div className="bg-card group hover:border-primary/40 flex flex-col rounded-xl border transition-colors">
      <div className="flex items-start gap-3 p-4">
        <OsIcon os={t.osType} />
        <div className="min-w-0 flex-1">
          <Link to="/templates/$ns/$name" params={{ ns: t.namespace, name: t.name }} className="line-clamp-1 font-medium hover:underline">
            {t.displayName}
          </Link>
          <div className="text-muted-foreground truncate text-xs">
            {t.namespace} · {t.name}
          </div>
        </div>
        <TemplateMenu t={t} onDeploy={onDeploy} />
      </div>
      {t.invalid ? (
        <div className="text-destructive flex items-start gap-2 px-4 pb-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t.invalid}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground line-clamp-2 min-h-10 px-4 text-sm">{t.description || "No description"}</p>
          <div className="text-muted-foreground grid grid-cols-3 gap-2 px-4 py-3 text-xs">
            <div>
              <div className="text-foreground tabular font-medium">{vmVCPUs({ spec } as never)} vCPU</div>
              {formatQuantity(spec.compute?.memorySize)}
            </div>
            <div className="min-w-0">
              <div className="text-foreground truncate font-medium">{refLabel(spec.bootConfiguration?.bootDisk?.source?.image)}</div>
              boot image
            </div>
            <div>
              <div className="text-foreground tabular font-medium">{t.parameters.length}</div>
              parameter{t.parameters.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex min-h-7 flex-wrap gap-1 px-4">
            {t.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        </>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t px-4 py-2.5">
        <span className="text-muted-foreground text-xs">
          {t.usageCount ? `${t.usageCount} VM${t.usageCount > 1 ? "s" : ""}` : "Unused"} · {relativeTime(t.createdAt)}
        </span>
        <Button size="sm" disabled={!!t.invalid || !can(t.namespace, "virtualmachines", "create")} onClick={onDeploy}>
          <Rocket /> Deploy
        </Button>
      </div>
    </div>
  );
}

function TemplatesPage() {
  const ns = useNamespace();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const q = useQuery(templatesQuery(ns));
  const authorable = useNamespacesWith("configmaps", "create");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("templates.view") as "grid") ?? "grid");
  const [deploy, setDeploy] = useState<Template | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const query = search.q ?? "";
  const items = q.data ?? [];
  const tags = [...new Set(items.flatMap((t) => t.tags))].sort();
  const filtered = items.filter(
    (t) =>
      (!search.tag || t.tags.includes(search.tag)) &&
      (!query || `${t.displayName} ${t.name} ${t.description ?? ""} ${t.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  );

  const columns = useMemo<ColumnDef<Template, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "displayName",
        header: ({ column }) => <SortHeader label="Template" column={column} />,
        cell: ({ row: { original: t } }) => (
          <div className="flex items-center gap-3">
            <OsIcon os={t.osType} small />
            <div className="min-w-0">
              <Link to="/templates/$ns/$name" params={{ ns: t.namespace, name: t.name }} className="font-medium hover:underline">
                {t.displayName}
              </Link>
              <div className="text-muted-foreground font-mono text-xs">{t.name}</div>
            </div>
            {t.invalid && <AlertTriangle className="text-destructive size-4" />}
          </div>
        ),
      },
      { id: "namespace", accessorKey: "namespace", header: ({ column }) => <SortHeader label="Namespace" column={column} /> },
      {
        id: "size",
        accessorFn: (t) => vmVCPUs({ spec: t.vm.spec } as never),
        header: "Size",
        cell: ({ row: { original: t } }) => (
          <span className="tabular text-sm">
            {vmVCPUs({ spec: t.vm.spec } as never)} vCPU · {formatQuantity(t.vm.spec.compute?.memorySize)}
          </span>
        ),
      },
      { id: "params", accessorFn: (t) => t.parameters.length, header: ({ column }) => <SortHeader label="Parameters" column={column} /> },
      {
        id: "tags",
        accessorFn: (t) => t.tags.join(" "),
        header: "Tags",
        cell: ({ row: { original: t } }) => (
          <div className="flex flex-wrap gap-1">
            {t.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[11px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        ),
      },
      { id: "usage", accessorFn: (t) => t.usageCount ?? 0, header: ({ column }) => <SortHeader label="VMs" column={column} /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: t } }) => <TemplateMenu t={t} onDeploy={() => setDeploy(t)} />,
      },
    ],
    [],
  );

  const importFile = async (file: File) => {
    try {
      const doc = parse(await file.text()) as Record<string, unknown>;
      const target = ns !== ALL && authorable.includes(ns) ? ns : authorable[0];
      if (!target) throw new Error("You cannot create templates in any namespace");
      const { kind: _k, namespace: _n, ...body } = doc;
      const created = await unwrap(api.namespaces[":ns"].templates.$post({ param: { ns: target }, query: {}, json: body }));
      toast.success(`Template ${created.displayName} imported into ${target}`);
      void navigate({ to: "/templates/$ns/$name", params: { ns: target, name: created.name } });
    } catch (e) {
      toast.error(`Import failed: ${errorMessage(e)}`);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Templates"
        icon={<LayoutTemplate className="size-5" />}
        description="Reusable VM definitions stored as ConfigMaps. Deploy one or many VMs in a few clicks."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
            <Button variant="outline" disabled={!authorable.length} onClick={() => fileRef.current?.click()}>
              <Upload /> Import
            </Button>
            <ButtonLink disabled={!authorable.length} to="/templates/new">
              <Plus /> New template
            </ButtonLink>
          </>
        }
      />
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate className="size-6" />}
          title="No templates yet"
          description="Create a template from scratch, or open an existing VM and use “Save as template”."
          action={
            authorable.length ? (
              <Button asChild>
                <Link to="/templates/new">
                  <Plus /> New template
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => navigate({ to: ".", search: { ...search, q: e.target.value || undefined }, replace: true })}
                placeholder="Search templates…"
                className="h-9 pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => navigate({ to: ".", search: { ...search, tag: search.tag === tag ? undefined : tag }, replace: true })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    search.tag === tag ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => {
                if (!v) return;
                setView(v as "grid");
                localStorage.setItem("templates.view", v);
              }}
              className="ml-auto"
            >
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {view === "grid" ? (
            filtered.length === 0 ? (
              <EmptyState title="No matching templates" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filtered.map((t) => (
                  <TemplateCard key={`${t.namespace}/${t.name}`} t={t} onDeploy={() => setDeploy(t)} />
                ))}
              </div>
            )
          ) : (
            <DataTable
              data={filtered}
              columns={columns}
              getRowId={(t) => `${t.namespace}/${t.name}`}
              onRowClick={(t) => navigate({ to: "/templates/$ns/$name", params: { ns: t.namespace, name: t.name } })}
            />
          )}
        </>
      )}
      {deploy && <DeployDialog template={deploy} open={!!deploy} onOpenChange={(o) => !o && setDeploy(null)} />}
    </Page>
  );
}
