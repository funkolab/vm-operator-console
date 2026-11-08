import { useSyncExternalStore } from "react";

export const ALL = "_all";
const KEY = "console.namespace";
const listeners = new Set<() => void>();
let current = localStorage.getItem(KEY) || ALL;

export function setNamespace(ns: string) {
  current = ns;
  localStorage.setItem(KEY, ns);
  for (const l of listeners) l();
}

export function getNamespace() {
  return current;
}

/** The globally selected namespace scope ("_all" means every accessible namespace). */
export function useNamespace(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
