import type { KubeObject, StreamMessage } from "@console/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { basePath } from "./api";
import { ALL } from "./namespace";

export type LiveStatus = "connecting" | "live" | "offline";

const LIST_KEY: Record<string, string> = {
  virtualmachines: "vms",
  virtualmachineservices: "services",
  nutanixprismcontexts: "contexts",
};
const ITEM_KEY: Record<string, string> = {
  virtualmachines: "vm",
  nutanixprismcontexts: "context",
};

function upsertLists(qc: QueryClient, listKey: string, m: StreamMessage) {
  for (const q of qc.getQueryCache().findAll({ queryKey: [listKey] })) {
    const scope = q.queryKey[1];
    if (scope !== ALL && scope !== m.namespace) continue;
    qc.setQueryData<KubeObject[]>(q.queryKey, (old) => {
      if (!old) return old;
      const idx = old.findIndex((o) => o.metadata.namespace === m.namespace && o.metadata.name === m.name);
      if (m.type === "DELETED") return idx >= 0 ? old.filter((_, i) => i !== idx) : old;
      const obj = m.object as KubeObject;
      if (idx < 0) return [...old, obj];
      const prev = old[idx] as KubeObject & Record<string, unknown>;
      // Keep server-computed decorations (e.g. vmCount) present on list items.
      const merged = { ...Object.fromEntries(Object.entries(prev).filter(([k]) => !["metadata", "spec", "status"].includes(k))), ...obj };
      const next = old.slice();
      next[idx] = merged as KubeObject;
      return next;
    });
  }
}

/**
 * Subscribes to server-sent watch events for the given namespaces and applies
 * them directly to the TanStack Query cache, so lists and detail pages update
 * in real time without polling.
 */
export function useLiveUpdates(namespaces: string[]): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const key = [...namespaces].sort().join(",");

  useEffect(() => {
    if (!key) {
      setStatus("offline");
      return;
    }
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const flushInvalidations = () => {
      for (const k of pending.current) void qc.invalidateQueries({ queryKey: [k] });
      pending.current.clear();
    };
    const scheduleInvalidate = (...keys: string[]) => {
      for (const k of keys) pending.current.add(k);
      if (!timer.current)
        timer.current = setTimeout(() => {
          timer.current = undefined;
          flushInvalidations();
        }, 1500);
    };

    const connect = () => {
      setStatus("connecting");
      es = new EventSource(`${basePath}/api/stream?namespaces=${encodeURIComponent(key)}`, { withCredentials: true });
      es.addEventListener("ready", () => {
        attempt = 0;
        setStatus("live");
      });
      es.addEventListener("batch", (ev) => {
        const batch = JSON.parse((ev as MessageEvent).data) as StreamMessage[];
        for (const m of batch) {
          const listKey = LIST_KEY[m.kind];
          if (listKey) upsertLists(qc, listKey, m);
          const itemKey = ITEM_KEY[m.kind];
          if (itemKey) {
            if (m.type === "DELETED") qc.removeQueries({ queryKey: [itemKey, m.namespace, m.name], exact: true });
            else
              qc.setQueryData([itemKey, m.namespace, m.name], (old: Record<string, unknown> | undefined) => (old ? { ...old, ...(m.object as object) } : old));
          }
          switch (m.kind) {
            case "virtualmachines":
              scheduleInvalidate("stats", "template-vms", "vm-services");
              break;
            case "virtualmachineservices":
              scheduleInvalidate("service", "stats", "vm-services");
              break;
            case "nutanixprismcontexts":
              scheduleInvalidate("stats");
              break;
            case "configmaps":
              scheduleInvalidate("templates", "template", "stats");
              break;
            case "events":
              scheduleInvalidate("events", "vm-events");
              break;
          }
        }
      });
      es.onerror = () => {
        es?.close();
        if (disposed) return;
        setStatus("offline");
        attempt++;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      };
    };
    connect();
    return () => {
      disposed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [key, qc]);

  return status;
}
