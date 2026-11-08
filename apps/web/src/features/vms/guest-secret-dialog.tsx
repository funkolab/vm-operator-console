import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form";
import { YamlEditor } from "@/components/lazy";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorMessage, unwrap } from "@/lib/api";

const CLOUD_INIT_SAMPLE = `#cloud-config
hostname: my-vm
users:
  - name: ops
    groups: [sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA... user@example
package_update: true
packages:
  - qemu-guest-agent
runcmd:
  - systemctl enable --now qemu-guest-agent
`;

const SYSPREP_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>WIN-VM</ComputerName>
      <TimeZone>UTC</TimeZone>
    </component>
  </settings>
</unattend>
`;

/** Creates a Secret holding a cloud-init or Sysprep script (impersonated). */
export function GuestSecretDialog({
  open,
  onOpenChange,
  namespace,
  type,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  namespace: string;
  type: "CloudInit" | "Sysprep";
  onCreated: (name: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [content, setContent] = useState(type === "Sysprep" ? SYSPREP_SAMPLE : CLOUD_INIT_SAMPLE);
  const m = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"]["guest-secrets"].$post({ param: { ns: namespace }, json: { name, type, content } })),
    onSuccess: () => {
      toast.success(`Secret ${name} saved`);
      void qc.invalidateQueries({ queryKey: ["guest-secrets", namespace] });
      onCreated(name);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New {type === "Sysprep" ? "Sysprep" : "cloud-init"} script</DialogTitle>
          <DialogDescription>
            Stored as a Kubernetes Secret in <span className="font-mono">{namespace}</span> under the key{" "}
            <span className="font-mono">{type === "Sysprep" ? "unattendXml" : "userData"}</span>. Only its name is referenced by the VM or template.
          </DialogDescription>
        </DialogHeader>
        <Field label="Secret name" required>
          {(id) => <Input id={id} value={name} placeholder="ubuntu-cloudinit" onChange={(e) => setName(e.target.value.toLowerCase())} />}
        </Field>
        <YamlEditor value={content} onChange={setContent} minHeight="300px" maxHeight="50vh" language={type === "Sysprep" ? "text" : "yaml"} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name || !content || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save secret
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
