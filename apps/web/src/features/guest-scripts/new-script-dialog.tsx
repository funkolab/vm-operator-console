import { DNS1123_SUBDOMAIN, GUEST_SCRIPT_KEYS, GUEST_SCRIPT_LABELS, type GuestScriptType } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/form";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, errorMessage, unwrap } from "@/lib/api";
import { hasErrors, SAMPLES, ScriptEditor, scriptIssues } from "./script-editor";

/**
 * Creates a cloud-init or Sysprep script (a labelled Secret). With `type` set,
 * the engine is fixed (opened from a VM form); with `namespaces`, the user picks
 * where to store it.
 */
export function NewScriptDialog({
  open,
  onOpenChange,
  namespace,
  namespaces,
  type: fixedType,
  initialContent,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  namespace: string;
  namespaces?: string[];
  type?: GuestScriptType;
  initialContent?: string;
  onCreated?: (s: { name: string; namespace: string }) => void;
}) {
  const qc = useQueryClient();
  const [ns, setNs] = useState(namespace);
  const [type, setType] = useState<GuestScriptType>(fixedType ?? "CloudInit");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState(initialContent ?? SAMPLES[fixedType ?? "CloudInit"]);
  const [edited, setEdited] = useState(!!initialContent);
  const nameError = name && !DNS1123_SUBDOMAIN.test(name) ? "Lowercase letters, digits, '-' and '.'" : undefined;
  const invalid = hasErrors(scriptIssues(type, content));

  const m = useMutation({
    mutationFn: () =>
      unwrap(api.namespaces[":ns"]["guest-secrets"].$post({ param: { ns }, json: { name, type, content, description: description.trim() || undefined } })),
    onSuccess: () => {
      toast.success(`${GUEST_SCRIPT_LABELS[type]} script ${name} created`);
      void qc.invalidateQueries({ queryKey: ["guest-secrets"] });
      onCreated?.({ name, namespace: ns });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New {fixedType ? GUEST_SCRIPT_LABELS[fixedType] : "guest customization"} script</DialogTitle>
          <DialogDescription>
            Stored as a Secret under the key <span className="font-mono">{GUEST_SCRIPT_KEYS[type]}</span>. VMs and templates reference it by name, from the same
            namespace.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={nameError}>
            {(id) => <Input id={id} autoFocus value={name} placeholder="ubuntu-base" onChange={(e) => setName(e.target.value.toLowerCase().trim())} />}
          </Field>
          {namespaces && namespaces.length > 1 ? (
            <Field label="Namespace" required>
              {(id) => (
                <Select value={ns} onValueChange={setNs}>
                  <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {namespaces.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Namespace">{(id) => <Input id={id} value={ns} disabled />}</Field>
          )}
          {!fixedType && (
            <Field label="Engine" required>
              {() => (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={type}
                  onValueChange={(v) => {
                    if (!v) return;
                    setType(v as GuestScriptType);
                    // Swap the sample only while the user has not typed anything of their own.
                    if (!edited) setContent(SAMPLES[v as GuestScriptType]);
                  }}
                  className="justify-start"
                >
                  <ToggleGroupItem value="CloudInit" className="px-3">
                    Cloud-init (Linux)
                  </ToggleGroupItem>
                  <ToggleGroupItem value="Sysprep" className="px-3">
                    Sysprep (Windows)
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </Field>
          )}
          <Field label="Description" className={fixedType ? "sm:col-span-2" : undefined}>
            {(id) => (
              <Input id={id} value={description} maxLength={500} placeholder="What this script sets up" onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
        <ScriptEditor
          type={type}
          value={content}
          onChange={(v) => {
            setContent(v);
            setEdited(true);
          }}
          minHeight="280px"
          maxHeight="45vh"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name || !!nameError || !ns || invalid || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Create script
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
