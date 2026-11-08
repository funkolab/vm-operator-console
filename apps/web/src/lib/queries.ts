import type { CatalogKind, ResourceName, Verb } from "@console/shared";
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { api, unwrap } from "./api";
import { ALL } from "./namespace";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => unwrap(api.me.$get()),
  staleTime: 60_000,
});

export const vmsQuery = (scope: string) =>
  queryOptions({
    queryKey: ["vms", scope],
    queryFn: async () =>
      (scope === ALL ? await unwrap(api.vms.$get({ query: {} })) : await unwrap(api.namespaces[":ns"].vms.$get({ param: { ns: scope }, query: {} }))).items,
    placeholderData: keepPreviousData,
  });

export const vmQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["vm", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"].vms[":name"].$get({ param: { ns, name } })),
  });

export const vmEventsQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["vm-events", ns, name],
    queryFn: async () => (await unwrap(api.namespaces[":ns"].vms[":name"].events.$get({ param: { ns, name } }))).items,
    refetchInterval: 30_000,
  });

export const vmServicesQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["vm-services", ns, name],
    queryFn: async () => (await unwrap(api.namespaces[":ns"].vms[":name"].services.$get({ param: { ns, name } }))).items,
  });

export const templatesQuery = (scope: string) =>
  queryOptions({
    queryKey: ["templates", scope],
    queryFn: async () =>
      (scope === ALL ? await unwrap(api.templates.$get()) : await unwrap(api.namespaces[":ns"].templates.$get({ param: { ns: scope } }))).items,
    placeholderData: keepPreviousData,
  });

export const templateQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["template", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"].templates[":name"].$get({ param: { ns, name } })),
  });

export const templateVMsQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["template-vms", ns, name],
    queryFn: async () => (await unwrap(api.namespaces[":ns"].templates[":name"].vms.$get({ param: { ns, name } }))).items,
  });

export const contextsQuery = (scope: string) =>
  queryOptions({
    queryKey: ["contexts", scope],
    queryFn: async () =>
      (scope === ALL ? await unwrap(api.contexts.$get()) : await unwrap(api.namespaces[":ns"].contexts.$get({ param: { ns: scope } }))).items,
    placeholderData: keepPreviousData,
  });

export const contextQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["context", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"].contexts[":name"].$get({ param: { ns, name } })),
  });

export const credentialSecretsQuery = (ns: string) =>
  queryOptions({
    queryKey: ["credential-secrets", ns],
    queryFn: async () => (await unwrap(api.namespaces[":ns"]["credential-secrets"].$get({ param: { ns } }))).items,
  });

export const guestSecretsQuery = (scope: string) =>
  queryOptions({
    queryKey: ["guest-secrets", scope],
    queryFn: async () =>
      (scope === ALL ? await unwrap(api["guest-secrets"].$get()) : await unwrap(api.namespaces[":ns"]["guest-secrets"].$get({ param: { ns: scope } }))).items,
    enabled: !!scope,
    placeholderData: keepPreviousData,
  });

export const guestScriptQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["guest-secret", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"]["guest-secrets"][":name"].$get({ param: { ns, name } })),
  });

export const servicesQuery = (scope: string) =>
  queryOptions({
    queryKey: ["services", scope],
    queryFn: async () =>
      (scope === ALL ? await unwrap(api.services.$get()) : await unwrap(api.namespaces[":ns"].services.$get({ param: { ns: scope } }))).items,
    placeholderData: keepPreviousData,
  });

export const serviceQuery = (ns: string, name: string) =>
  queryOptions({
    queryKey: ["service", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"].services[":name"].$get({ param: { ns, name } })),
  });

export const statsQuery = (scope: string) =>
  queryOptions({
    queryKey: ["stats", scope],
    queryFn: () => unwrap(api.stats.$get({ query: scope === ALL ? {} : { namespace: scope } })),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

export const eventsQuery = (scope: string) =>
  queryOptions({
    queryKey: ["events", scope],
    queryFn: async () => (scope === ALL ? await unwrap(api.events.$get()) : await unwrap(api.namespaces[":ns"].events.$get({ param: { ns: scope } }))).items,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

export const catalogQuery = (ns: string, context: string | undefined, kind: CatalogKind) =>
  queryOptions({
    queryKey: ["catalog", ns, context, kind],
    queryFn: () => unwrap(api.namespaces[":ns"].contexts[":name"].catalog[":kind"].$get({ param: { ns, name: context as string, kind }, query: {} })),
    enabled: !!ns && ns !== ALL && !!context,
    staleTime: 5 * 60_000,
    retry: false,
  });

export function useMe() {
  return useQuery(meQuery);
}

/** RBAC-aware permission check, computed server-side from the impersonated user's SubjectAccessReviews. */
export function useCan() {
  const { data } = useMe();
  return (ns: string | undefined, resource: ResourceName, verb: Verb): boolean => {
    if (!data || !ns) return false;
    return data.namespaces.find((n) => n.name === ns)?.permissions[resource]?.[verb] === true;
  };
}

/** Namespaces where the user holds a given permission. */
export function useNamespacesWith(resource: ResourceName, verb: Verb): string[] {
  const { data } = useMe();
  return (data?.namespaces ?? []).filter((n) => n.permissions[resource]?.[verb]).map((n) => n.name);
}

/**
 * Namespace preselected in creation forms: the one picked in the top bar, else
 * the first one holding a Prism Central context (VMs only bind contexts from
 * their own namespace), else the first allowed one.
 */
export function usePreferredNamespace(namespaces: string[], scope: string): { namespace: string; loading: boolean } {
  const explicit = scope !== ALL && namespaces.includes(scope);
  const contexts = useQuery({ ...contextsQuery(ALL), enabled: !explicit && namespaces.length > 1 });
  if (explicit) return { namespace: scope, loading: false };
  if (contexts.isLoading) return { namespace: "", loading: true };
  const withContext = new Set((contexts.data ?? []).map((c) => c.metadata.namespace));
  return { namespace: namespaces.find((n) => withContext.has(n)) ?? namespaces[0] ?? "", loading: false };
}
