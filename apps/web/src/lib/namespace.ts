import type { WorkspaceAccess } from "@console/shared";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, unwrap } from "./api";

/**
 * The UI scope is a workspace. Each workspace maps to exactly one namespace,
 * which is what the API and Kubernetes use; the namespace itself is never
 * shown. "_all" means every workspace the user can access.
 */
export const ALL = "_all";
const KEY = "console.workspace";
const listeners = new Set<() => void>();
let current = localStorage.getItem(KEY) || ALL;

export function setWorkspace(ws: string) {
  current = ws;
  localStorage.setItem(KEY, ws);
  for (const l of listeners) l();
}

function useStoredWorkspace(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => unwrap(api.me.$get()),
  staleTime: 60_000,
});

const useMeData = () => useQuery(meQuery).data;

/** Every workspace the user can access. */
export function useWorkspaces(): WorkspaceAccess[] {
  return useMeData()?.workspaces ?? [];
}

/** The selected workspace (undefined for "all workspaces" or while loading). */
export function useWorkspace(): WorkspaceAccess | undefined {
  const name = useStoredWorkspace();
  const workspaces = useWorkspaces();
  return name === ALL ? undefined : workspaces.find((w) => w.name === name);
}

/** Name of the selected workspace, or ALL. */
export function useWorkspaceName(): string {
  return useStoredWorkspace();
}

/**
 * The namespace scope behind the selected workspace (ALL when every workspace
 * is selected). Data queries and live updates are keyed on it.
 */
export function useNamespace(): string {
  const ws = useWorkspace();
  return ws?.namespace ?? ALL;
}

/** Maps namespaces to workspaces, to show workspace names wherever a namespace appears. */
export function useWorkspaceOf(): (namespace: string | undefined) => WorkspaceAccess | undefined {
  const workspaces = useWorkspaces();
  return (namespace) => (namespace ? workspaces.find((w) => w.namespace === namespace) : undefined);
}

/** Display label of the workspace holding a namespace (falls back to the namespace). */
export function useWorkspaceLabel(): (namespace: string | undefined) => string {
  const of = useWorkspaceOf();
  return (namespace) => of(namespace)?.displayName ?? namespace ?? "";
}
