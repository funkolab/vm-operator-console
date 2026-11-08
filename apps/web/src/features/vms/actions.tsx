import { Annotations, type PowerAction, type VirtualMachine } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, LayoutTemplate, MoreHorizontal, Pause, Pencil, Play, Power, RotateCcw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ButtonLink } from "@/components/button-link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useCan } from "@/lib/queries";
import { SaveAsTemplateDialog } from "../templates/save-as-template-dialog";
import { CloneDialog } from "./clone-dialog";

const LABEL: Record<PowerAction, string> = {
  start: "Power on",
  stop: "Power off",
  restart: "Restart",
  pause: "Pause reconciliation",
  resume: "Resume reconciliation",
};

export function usePowerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ns, name, action }: { ns: string; name: string; action: PowerAction }) =>
      unwrap(api.namespaces[":ns"].vms[":name"].actions[":action"].$post({ param: { ns, name, action } })),
    onSuccess: (vm, v) => {
      toast.success(`${LABEL[v.action]} requested for ${v.name}`);
      qc.setQueryData(["vm", v.ns, v.name], vm);
    },
    onError: (e, v) => toast.error(`${LABEL[v.action]} failed: ${errorMessage(e)}`),
  });
}

export function useDeleteVM() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ns, name }: { ns: string; name: string }) => unwrap(api.namespaces[":ns"].vms[":name"].$delete({ param: { ns, name }, query: {} })),
    onSuccess: (_d, v) => {
      toast.success(`Deletion of ${v.name} requested`);
      void qc.invalidateQueries({ queryKey: ["vms"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

/** Power, clone, template and delete actions for a VM, honoring the user's RBAC. */
export function VMActions({ vm, variant = "menu" }: { vm: VirtualMachine; variant?: "menu" | "buttons" }) {
  const ns = vm.metadata.namespace as string;
  const name = vm.metadata.name as string;
  const can = useCan();
  const navigate = useNavigate();
  const power = usePowerAction();
  const del = useDeleteVM();
  const [confirm, setConfirm] = useState<"delete" | "stop" | "restart" | null>(null);
  const [clone, setClone] = useState(false);
  const [saveTpl, setSaveTpl] = useState(false);
  const canPatch = can(ns, "virtualmachines", "patch");
  const canCreate = can(ns, "virtualmachines", "create");
  const canDelete = can(ns, "virtualmachines", "delete");
  const canTemplate = can(ns, "configmaps", "create");
  const paused = Object.hasOwn(vm.metadata.annotations ?? {}, Annotations.paused);
  const desiredOn = (vm.spec.powerState ?? "On") === "On";
  const deleting = !!vm.metadata.deletionTimestamp;
  const run = (action: PowerAction) => power.mutate({ ns, name, action });

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${name}?`}
        destructive
        confirmLabel="Delete VM"
        typeToConfirm={name}
        description={<>The VirtualMachine resource and the VM on Nutanix will be deleted, including all of its disks. This cannot be undone.</>}
        onConfirm={async () => {
          await del.mutateAsync({ ns, name });
          void navigate({ to: "/vms" });
        }}
      />
      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Power off ${name}?`}
        description="The VM will be powered off. Unsaved data in the guest may be lost."
        confirmLabel="Power off"
        onConfirm={() => power.mutateAsync({ ns, name, action: "stop" })}
      />
      <ConfirmDialog
        open={confirm === "restart"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Restart ${name}?`}
        description="The console powers the VM off, waits until it is observed off, then powers it back on."
        confirmLabel="Restart"
        onConfirm={() => power.mutateAsync({ ns, name, action: "restart" })}
      />
      {clone && <CloneDialog vm={vm} open={clone} onOpenChange={setClone} />}
      {saveTpl && <SaveAsTemplateDialog vm={vm} open={saveTpl} onOpenChange={setSaveTpl} />}
    </>
  );

  const menuItems = (
    <>
      {variant === "menu" && (
        <>
          <DropdownMenuItem disabled={!canPatch || desiredOn || deleting} onSelect={() => run("start")}>
            <Play /> Power on
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canPatch || !desiredOn || deleting} onSelect={() => setConfirm("stop")}>
            <Square /> Power off
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canPatch || !vm.status?.externalID || paused || deleting} onSelect={() => setConfirm("restart")}>
            <RotateCcw /> Restart
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild disabled={!can(ns, "virtualmachines", "update")}>
            <Link to="/vms/$ns/$name/edit" params={{ ns, name }}>
              <Pencil /> Edit
            </Link>
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuItem disabled={!canCreate} onSelect={() => setClone(true)}>
        <Copy /> Clone
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canTemplate} onSelect={() => setSaveTpl(true)}>
        <LayoutTemplate /> Save as template
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canPatch} onSelect={() => run(paused ? "resume" : "pause")}>
        <Pause /> {paused ? "Resume reconciliation" : "Pause reconciliation"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={!canDelete || deleting} onSelect={() => setConfirm("delete")}>
        <Trash2 /> Delete
      </DropdownMenuItem>
    </>
  );

  if (variant === "buttons")
    return (
      <>
        {desiredOn ? (
          <Button variant="outline" size="sm" disabled={!canPatch || deleting || power.isPending} onClick={() => setConfirm("stop")}>
            <Square /> Power off
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={!canPatch || deleting || power.isPending} onClick={() => run("start")}>
            <Power /> Power on
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={!canPatch || !vm.status?.externalID || paused || deleting} onClick={() => setConfirm("restart")}>
          <RotateCcw /> Restart
        </Button>
        <ButtonLink variant="outline" size="sm" disabled={!can(ns, "virtualmachines", "update") || deleting} to="/vms/$ns/$name/edit" params={{ ns, name }}>
          <Pencil /> Edit
        </ButtonLink>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-8" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {menuItems}
          </DropdownMenuContent>
        </DropdownMenu>
        {dialogs}
      </>
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}
