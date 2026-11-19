import { summarizeVM, type VirtualMachine, type VMPhase } from "@console/shared";
import { toast } from "sonner";

/**
 * VMs the user just acted on. When a live update shows the operation settled
 * (running, stopped or failed), the user gets a notification — no need to
 * keep the page open or refresh.
 */
const followed = new Map<string, { label: string; until: number; from?: VMPhase }>();
const TERMINAL: VMPhase[] = ["Running", "Stopped", "Error", "Degraded"];

export function followVM(ns: string, name: string, label: string, current?: VirtualMachine) {
  followed.set(`${ns}/${name}`, { label, until: Date.now() + 15 * 60_000, from: current ? summarizeVM(current).phase : undefined });
}

export function onVMUpdate(vm: VirtualMachine) {
  const key = `${vm.metadata.namespace}/${vm.metadata.name}`;
  const f = followed.get(key);
  if (!f) return;
  if (f.until < Date.now()) {
    followed.delete(key);
    return;
  }
  const s = summarizeVM(vm);
  if (!TERMINAL.includes(s.phase) || s.converging || vm.status?.activeTask) return;
  // Ignore the snapshot taken right when the action was requested.
  if (s.phase === f.from && (vm.metadata.generation ?? 0) > (vm.status?.appliedGeneration ?? 0)) return;
  followed.delete(key);
  const title = `${s.displayName}: ${f.label} ${s.phase === "Error" || s.phase === "Degraded" ? "failed" : "completed"}`;
  if (s.phase === "Error" || s.phase === "Degraded") toast.error(title, { description: s.readyMessage });
  else toast.success(title, { description: s.phase === "Running" ? `Running${s.primaryIP ? ` · ${s.primaryIP}` : ""}` : "Powered off" });
}
