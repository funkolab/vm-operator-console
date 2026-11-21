import { DNS1123_LABEL, type VirtualMachine } from "@console/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WorkspaceSelect } from "@/components/workspace-select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useWorkspace } from "@/lib/namespace";
import { useWorkspacesWith } from "@/lib/queries";

export function CloneDialog({ vm, open, onOpenChange }: { vm: VirtualMachine; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ns = vm.metadata.namespace as string;
  const src = vm.metadata.name as string;
  const navigate = useNavigate();
  const allowed = useWorkspacesWith("virtualmachines", "create");
  // Clones stay in the VM's workspace unless the user works across all workspaces.
  const selected = useWorkspace();
  const targets = selected ? allowed.filter((w) => w.namespace === ns) : allowed;
  const [name, setName] = useState(`${src}-clone`.slice(0, 63));
  const [targetNs, setTargetNs] = useState(targets.some((w) => w.namespace === ns) ? ns : (targets[0]?.namespace ?? ns));
  const [displayName, setDisplayName] = useState("");
  const [powerOn, setPowerOn] = useState((vm.spec.powerState ?? "On") === "On");
  const valid = DNS1123_LABEL.test(name) && name.length <= 63 && targets.some((w) => w.namespace === targetNs);
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].vms[":name"].clone.$post({
          param: { ns, name: src },
          json: { name, namespace: targetNs, displayName: displayName || undefined, powerState: powerOn ? "On" : "Off" },
        }),
      ),
    onSuccess: () => {
      toast.success(`Clone ${name} created`);
      onOpenChange(false);
      void navigate({ to: "/vms/$ns/$name", params: { ns: targetNs, name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone {src}</DialogTitle>
          <DialogDescription>
            Creates a new VM with the same configuration. Identity (BIOS UUID), status and controller annotations are not copied.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" required error={!valid ? "Lowercase letters, digits and '-' (max 63)" : undefined}>
            {(id) => <Input id={id} value={name} autoFocus onChange={(e) => setName(e.target.value.toLowerCase())} />}
          </Field>
          <Field label="Display name" hint="Defaults to the name">
            {(id) => <Input id={id} value={displayName} maxLength={64} onChange={(e) => setDisplayName(e.target.value)} />}
          </Field>
          <Field label="Workspace" hint={targetNs !== ns ? "The Prism Central context reference is reset when cloning to another workspace" : undefined}>
            {(id) => <WorkspaceSelect id={id} value={targetNs} options={targets} onChange={setTargetNs} />}
          </Field>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
            Power on after creation
            <Switch checked={powerOn} onCheckedChange={setPowerOn} />
          </label>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              void navigate({ to: "/vms/new", search: { from: `${ns}/${src}` } });
            }}
          >
            <Pencil /> Customize all fields
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!valid || m.isPending} onClick={() => m.mutate()}>
              {m.isPending && <Spinner />} Clone
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
