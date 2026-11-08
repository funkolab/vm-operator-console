import { DNS1123_LABEL, type VirtualMachine } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Field, TagInput } from "@/components/form";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, unwrap } from "@/lib/api";

export function SaveAsTemplateDialog({ vm, open, onOpenChange }: { vm: VirtualMachine; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ns = vm.metadata.namespace as string;
  const src = vm.metadata.name as string;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(src.slice(0, 58));
  const [displayName, setDisplayName] = useState(vm.spec.displayName || src);
  const [description, setDescription] = useState(vm.spec.description ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [osType, setOsType] = useState<"Linux" | "Windows" | "Other">(vm.spec.guestCustomization?.type === "Sysprep" ? "Windows" : "Linux");
  const valid = DNS1123_LABEL.test(name) && name.length <= 58 && displayName.trim().length > 0;
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].vms[":name"]["save-as-template"].$post({
          param: { ns, name: src },
          json: { name, displayName, description: description || undefined, tags, osType },
        }),
      ),
    onSuccess: (t) => {
      toast.success(`Template ${t.displayName} saved`);
      void qc.invalidateQueries({ queryKey: ["templates"] });
      onOpenChange(false);
      void navigate({ to: "/templates/$ns/$name/edit", params: { ns, name: t.name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save {src} as a template</DialogTitle>
          <DialogDescription>
            The VM configuration is stored in a ConfigMap in <span className="font-mono">{ns}</span>. You can then choose which fields to ask for at deploy
            time.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Template ID" required error={!DNS1123_LABEL.test(name) ? "Lowercase letters, digits and '-' (max 58)" : undefined}>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />}
          </Field>
          <Field label="Display name" required>
            {(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          </Field>
          <Field label="Description">{(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label="OS">
              {(id) => (
                <Select value={osType} onValueChange={(v) => setOsType(v as typeof osType)}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Linux">Linux</SelectItem>
                    <SelectItem value="Windows">Windows</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label="Tags">{() => <TagInput value={tags} onChange={setTags} />}</Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
