import { DNS1123_LABEL, type VMTemplate } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useNamespacesWith } from "@/lib/queries";

export function DuplicateDialog({
  template,
  open,
  onOpenChange,
}: {
  template: Pick<VMTemplate, "name" | "namespace" | "displayName">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const targets = useNamespacesWith("configmaps", "create");
  const [name, setName] = useState(`${template.name}-copy`.slice(0, 58));
  const [displayName, setDisplayName] = useState(`${template.displayName} (copy)`);
  const [ns, setNs] = useState(targets.includes(template.namespace) ? template.namespace : (targets[0] ?? ""));
  const valid = DNS1123_LABEL.test(name) && name.length <= 58 && !!ns;
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].templates[":name"].duplicate.$post({
          param: { ns: template.namespace, name: template.name },
          json: { name, displayName, namespace: ns },
        }),
      ),
    onSuccess: (t) => {
      toast.success(`Template ${t.displayName} created`);
      void qc.invalidateQueries({ queryKey: ["templates"] });
      onOpenChange(false);
      void navigate({ to: "/templates/$ns/$name", params: { ns, name: t.name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate {template.displayName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Template ID" required error={!DNS1123_LABEL.test(name) ? "Lowercase letters, digits and '-'" : undefined}>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} />}
          </Field>
          <Field label="Display name" required>
            {(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          </Field>
          <Field label="Namespace">
            {(id) => (
              <Select value={ns} onValueChange={setNs}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
