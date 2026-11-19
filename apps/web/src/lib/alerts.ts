import { getCondition, type NutanixPrismContext, summarizeVM, type VirtualMachine } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { useNamespace } from "./namespace";
import { contextsQuery, vmsQuery } from "./queries";

export type AlertSeverity = "critical" | "warning" | "info";

export interface ConsoleAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  kind: "vm" | "context";
  namespace: string;
  name: string;
  since?: string;
}

const SEEN_KEY = "console.alerts.seen";
const listeners = new Set<() => void>();
let seen: Set<string> = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);

export function markAlertsSeen(ids: string[]) {
  seen = new Set([...seen, ...ids]);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500)));
  for (const l of listeners) l();
}

function useSeen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => seen,
  );
}

/** Derives actionable alerts from the live VM and context state. */
export function deriveAlerts(vms: VirtualMachine[], contexts: NutanixPrismContext[]): ConsoleAlert[] {
  const out: ConsoleAlert[] = [];
  for (const vm of vms) {
    const s = summarizeVM(vm);
    const ready = getCondition(vm.status?.conditions, "Ready");
    if (s.phase === "Error")
      out.push({
        id: `vm-error:${s.key}:${ready?.lastTransitionTime ?? ""}`,
        severity: "critical",
        title: `${s.displayName} failed`,
        detail: [s.readyReason, s.readyMessage].filter(Boolean).join(": "),
        kind: "vm",
        namespace: s.namespace,
        name: s.name,
        since: ready?.lastTransitionTime,
      });
    else if (s.phase === "Degraded")
      out.push({
        id: `vm-degraded:${s.key}:${ready?.lastTransitionTime ?? ""}`,
        severity: "warning",
        title: `${s.displayName} is degraded`,
        detail: s.readyMessage,
        kind: "vm",
        namespace: s.namespace,
        name: s.name,
        since: ready?.lastTransitionTime,
      });
    if (s.driftCount > 0) {
      const d = getCondition(vm.status?.conditions, "Drifted");
      out.push({
        id: `vm-drift:${s.key}:${d?.lastTransitionTime ?? s.driftCount}`,
        severity: "warning",
        title: `${s.displayName} drifted from its spec`,
        detail: `${s.driftCount} field(s) changed outside Kubernetes`,
        kind: "vm",
        namespace: s.namespace,
        name: s.name,
        since: d?.lastTransitionTime,
      });
    }
    const powerOff = vm.status?.conditions?.find((c) => (c.reason === "PowerOffRequired" || c.type === "PowerOffRequired") && c.status !== "False");
    if (powerOff)
      out.push({
        id: `vm-poweroff:${s.key}:${powerOff.lastTransitionTime ?? ""}`,
        severity: "info",
        title: `${s.displayName} needs a power cycle`,
        detail: powerOff.message || "Pending changes are applied at the next power off / on",
        kind: "vm",
        namespace: s.namespace,
        name: s.name,
        since: powerOff.lastTransitionTime,
      });
  }
  for (const c of contexts) {
    const cd = getCondition(c.status?.conditions, "Connected");
    if (cd && cd.status !== "True")
      out.push({
        id: `ctx:${c.metadata.namespace}/${c.metadata.name}:${cd.lastTransitionTime ?? ""}`,
        severity: "critical",
        title: `Prism Central ${c.metadata.name} is disconnected`,
        detail: cd.message || cd.reason,
        kind: "context",
        namespace: c.metadata.namespace as string,
        name: c.metadata.name as string,
        since: cd.lastTransitionTime,
      });
  }
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.since ?? "").localeCompare(a.since ?? ""));
}

export function useAlerts() {
  const ns = useNamespace();
  const vms = useQuery({ ...vmsQuery(ns), staleTime: 15_000 });
  const ctxs = useQuery({ ...contextsQuery(ns), staleTime: 30_000 });
  const seenIds = useSeen();
  return useMemo(() => {
    const alerts = deriveAlerts(vms.data ?? [], ctxs.data ?? []);
    return { alerts, unseen: alerts.filter((a) => !seenIds.has(a.id)) };
  }, [vms.data, ctxs.data, seenIds]);
}
