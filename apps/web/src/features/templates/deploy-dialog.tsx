import {
  expandNamePattern,
  initialParameterValues,
  instantiateTemplate,
  isValidVMName,
  MAX_INSTANCES,
  type VMTemplate,
  validateParameterValues,
  validateVirtualMachine,
} from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Eye, Rocket, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { stringify } from "yaml";
import { Field, NumberInput } from "@/components/form";
import { YamlEditor } from "@/components/lazy";
import { Spinner } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ParameterInput } from "./parameter-input";

type Result = { name: string; ok: boolean; error?: string };

export function DeployDialog({ template: t, open, onOpenChange }: { template: VMTemplate; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>(() => initialParameterValues(t));
  const [pattern, setPattern] = useState(t.name);
  const [count, setCount] = useState(1);
  const [powerOn, setPowerOn] = useState((t.vm.spec.powerState ?? "On") === "On");
  const [preview, setPreview] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const names = useMemo(() => {
    try {
      return expandNamePattern(pattern, count);
    } catch {
      return [];
    }
  }, [pattern, count]);
  const badNames = names.filter((n) => !isValidVMName(n));
  const paramErrors = validateParameterValues(t, values);
  const rendered = useMemo(
    () => instantiateTemplate(t, { name: names[0] ?? "preview", namespace: t.namespace, values, powerState: powerOn ? "On" : "Off" }),
    [t, names, values, powerOn],
  );
  const vmIssues = paramErrors.length ? [] : validateVirtualMachine(rendered, { mode: "create" });
  const valid = names.length > 0 && names.length <= MAX_INSTANCES && !badNames.length && !paramErrors.length && !vmIssues.length;
  const context = (values.context as string) || t.vm.spec.context?.name;

  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].templates[":name"].instantiate.$post({
          param: { ns: t.namespace, name: t.name },
          json: { namePattern: pattern, count, values, powerState: powerOn ? "On" : "Off" },
        }),
      ),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["vms"] });
      void qc.invalidateQueries({ queryKey: ["templates"] });
      const ok = res.results.filter((r) => r.ok);
      if (ok.length === res.results.length) {
        toast.success(ok.length === 1 ? `VM ${ok[0]?.name} created` : `${ok.length} VMs created`);
        onOpenChange(false);
        if (ok.length === 1) void navigate({ to: "/vms/$ns/$name", params: { ns: t.namespace, name: ok[0]?.name as string } });
        else void navigate({ to: "/vms", search: { q: names[0]?.replace(/\d+$/, "") } });
      } else setResults(res.results);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5" /> Deploy {t.displayName}
          </DialogTitle>
          <DialogDescription>
            Creates VirtualMachines in <span className="font-mono">{t.namespace}</span> from this template.
          </DialogDescription>
        </DialogHeader>
        {results ? (
          <div className="grid max-h-[60vh] gap-2 overflow-auto">
            {results.map((r) => (
              <div key={r.name} className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                {r.ok ? <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" /> : <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />}
                <div className="min-w-0">
                  <div className="font-mono">{r.name}</div>
                  {r.error && <div className="text-destructive text-xs break-words">{r.error}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid max-h-[65vh] gap-5 overflow-auto px-0.5">
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field
                label="VM name"
                required
                error={submitted && badNames.length ? `Invalid name: ${badNames[0]}` : undefined}
                hint={
                  count > 1 || pattern.includes("{")
                    ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? `, … (${names.length})` : ""}`
                    : "Use web-{01..05} or web-{#} to create several VMs"
                }
              >
                {(id) => <Input id={id} value={pattern} autoFocus onChange={(e) => setPattern(e.target.value.toLowerCase())} />}
              </Field>
              <Field label="Instances">
                {(id) => (
                  <NumberInput id={id} min={1} max={MAX_INSTANCES} value={count} onChange={(v) => setCount(Math.min(MAX_INSTANCES, Math.max(1, v ?? 1)))} />
                )}
              </Field>
            </div>
            {t.parameters.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {t.parameters.map((p) => (
                  <div key={p.name} className={p.type.endsWith("Ref") ? "sm:col-span-2" : undefined}>
                    <ParameterInput
                      param={p}
                      value={values[p.name]}
                      onChange={(v) => setValues({ ...values, [p.name]: v })}
                      namespace={t.namespace}
                      context={context}
                      showError={submitted}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-sm">
                This template has no parameters; VMs are created exactly as defined.
              </p>
            )}
            <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">
              Power on after creation
              <Switch checked={powerOn} onCheckedChange={setPowerOn} />
            </label>
            {submitted && vmIssues.length > 0 && (
              <ul className="text-destructive grid gap-1 text-sm">
                {vmIssues.map((i) => (
                  <li key={i.path + i.message}>
                    <span className="font-mono text-xs">{i.path}</span>: {i.message}
                  </li>
                ))}
              </ul>
            )}
            {preview && <YamlEditor value={stringify(rendered, { lineWidth: 0 })} readOnly minHeight="240px" maxHeight="40vh" />}
          </div>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          {results ? (
            <Button className="ml-auto" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setPreview(!preview)}>
                  <Eye /> {preview ? "Hide" : "Preview"} YAML
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {names.length > 1 && <Badge variant="secondary">{names.length} VMs</Badge>}
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={m.isPending}
                  onClick={() => {
                    setSubmitted(true);
                    if (valid) m.mutate();
                  }}
                >
                  {m.isPending && <Spinner />} Deploy
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
