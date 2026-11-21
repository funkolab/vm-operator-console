import type { ResourceName, Verb, WorkspaceAccess } from "@console/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { Layers, ShieldAlert } from "lucide-react";
import { facetFilterFn, SortHeader } from "@/components/data-table";
import { EmptyState } from "@/components/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace, useWorkspaceLabel, useWorkspaces } from "@/lib/namespace";
import { cn } from "@/lib/utils";

/**
 * Where a new resource goes: the workspace selected in the top bar, or a
 * choice among the allowed workspaces when "All workspaces" is selected.
 * `denied` is set when the selected workspace does not allow the action.
 */
export function useCreateTargets(resource: ResourceName, verb: Verb = "create"): { workspaces: WorkspaceAccess[]; denied?: WorkspaceAccess } {
  const selected = useWorkspace();
  const allowed = useWorkspaces().filter((w) => w.permissions[resource]?.[verb]);
  if (!selected) return { workspaces: allowed };
  return allowed.some((w) => w.name === selected.name) ? { workspaces: [selected] } : { workspaces: [], denied: selected };
}

/** Shown instead of a creation form when the selected workspace does not allow it. */
export function CreateDenied({ what, workspace }: { what: string; workspace?: WorkspaceAccess }) {
  const others = useWorkspaces().length > 1;
  return (
    <EmptyState
      icon={<ShieldAlert className="size-6" />}
      title={workspace ? `Read-only workspace` : `Not allowed`}
      description={
        workspace
          ? `Your role does not allow creating ${what} in workspace ${workspace.displayName}.${others ? " Select another workspace in the top bar." : ""}`
          : `Your role does not allow creating ${what} in any workspace.`
      }
    />
  );
}

/**
 * Workspace of a resource being created or edited. Shown read-only when it is
 * fixed (a workspace is selected, or the resource already exists); a picker of
 * workspace names otherwise. Values are the workspace namespaces.
 */
export function WorkspaceSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  id?: string;
  /** Namespace of the selected workspace. */
  value: string;
  onChange?: (namespace: string) => void;
  options: WorkspaceAccess[];
  disabled?: boolean;
  className?: string;
}) {
  const label = useWorkspaceLabel();
  if (disabled || options.length <= 1 || !onChange)
    return (
      <div id={id} className={cn("bg-muted/40 text-foreground flex h-9 w-full min-w-0 items-center gap-2 rounded-md border px-3 text-sm", className)}>
        <Layers className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{label(value) || "—"}</span>
      </div>
    );
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder="Select a workspace" />
      </SelectTrigger>
      <SelectContent>
        {options.map((w) => (
          <SelectItem key={w.name} value={w.namespace}>
            {w.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Workspace badge for a namespace, shown where resources used to display their namespace. */
export function WorkspaceTag({ namespace, className }: { namespace?: string; className?: string }) {
  const label = useWorkspaceLabel();
  if (!namespace) return null;
  return (
    <span className={cn("text-muted-foreground inline-flex min-w-0 items-center gap-1", className)} title="Workspace">
      <Layers className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{label(namespace)}</span>
    </span>
  );
}

/** Data table column showing the workspace of each row (sortable and facetable by workspace name). */
export function useWorkspaceColumn<T>(getNamespace: (row: T) => string | undefined, opts: { facet?: boolean } = {}): ColumnDef<T, unknown> {
  const label = useWorkspaceLabel();
  return {
    id: "workspace",
    accessorFn: (row) => label(getNamespace(row)),
    meta: { label: "Workspace" },
    header: ({ column }) => <SortHeader label="Workspace" column={column} />,
    ...(opts.facet ? { filterFn: facetFilterFn } : {}),
    cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span>,
  };
}

/** Columns to hide when a single workspace is selected. */
export function useScopedHiddenColumns(): string[] {
  return useWorkspace() ? ["workspace"] : [];
}
