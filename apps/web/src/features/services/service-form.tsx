import { ApiVersions, type VirtualMachineService, type VMServicePort, validateVirtualMachineService } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus, Server, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, KeyValueEditor, NumberInput } from "@/components/form";
import { Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/features/vms/spec-editor";
import { api, errorIssues, unwrap } from "@/lib/api";

export function emptyService(ns: string): VirtualMachineService {
  return {
    apiVersion: ApiVersions.vmm,
    kind: "VirtualMachineService",
    metadata: { name: "", namespace: ns },
    spec: { selector: { matchLabels: {} }, type: "ClusterIP", ports: [{ name: "http", port: 80, protocol: "TCP" }] },
  };
}

function useDebounced<T>(v: T, ms = 400): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function ServiceForm({
  initial,
  mode,
  namespaces,
  onSubmit,
  onCancel,
  serverError,
}: {
  initial: VirtualMachineService;
  mode: "create" | "edit";
  namespaces: string[];
  onSubmit: (s: VirtualMachineService) => Promise<unknown>;
  onCancel: () => void;
  serverError?: unknown;
}) {
  const [svc, setSvc] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const ns = svc.metadata.namespace as string;
  const issues = [...validateVirtualMachineService(svc), ...errorIssues(serverError)];
  const err = (p: string) => (touched ? issues.find((i) => i.path === p || i.path.startsWith(`${p}/`))?.message : undefined);
  const selector = useDebounced(svc.spec.selector);
  const preview = useQuery({
    queryKey: ["selector-preview", ns, selector],
    queryFn: () => unwrap(api.namespaces[":ns"].services["preview-selector"].$post({ param: { ns }, json: { selector: selector as never } })),
    enabled: !!ns,
  });
  const ports = svc.spec.ports;
  const setPorts = (p: VMServicePort[]) => setSvc({ ...svc, spec: { ...svc.spec, ports: p } });
  const probe = svc.spec.endpointProbe;

  return (
    <div className="grid gap-5">
      <SectionCard icon={<Server className="size-4" />} title="Service">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            required
            error={err("/metadata/name")}
            hint={`DNS: ${svc.metadata.name || "<name>"}.${ns}.svc.cluster.local`}
            locked={mode === "edit" ? "The name cannot be changed" : undefined}
          >
            {(id) => (
              <Input
                id={id}
                disabled={mode === "edit"}
                value={svc.metadata.name ?? ""}
                maxLength={63}
                onChange={(e) => setSvc({ ...svc, metadata: { ...svc.metadata, name: e.target.value.toLowerCase() } })}
              />
            )}
          </Field>
          <Field label="Namespace" required>
            {(id) => (
              <Select value={ns} disabled={mode === "edit"} onValueChange={(v) => setSvc({ ...svc, metadata: { ...svc.metadata, namespace: v } })}>
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
          <Field label="Type" doc="VirtualMachineService/spec/type">
            {(id) => (
              <Select
                value={svc.spec.headless ? "headless" : (svc.spec.type ?? "ClusterIP")}
                onValueChange={(v) =>
                  setSvc({ ...svc, spec: { ...svc.spec, type: v === "LoadBalancer" ? "LoadBalancer" : "ClusterIP", headless: v === "headless" || undefined } })
                }
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ClusterIP">ClusterIP (virtual IP)</SelectItem>
                  <SelectItem value="headless">Headless (DNS records per VM)</SelectItem>
                  <SelectItem value="LoadBalancer">LoadBalancer (external address)</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        icon={<Server className="size-4" />}
        title="VM selector"
        description="VMs in the same namespace whose labels match. Only powered-on VMs with an IPv4 address serve traffic."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Field label="Match labels" error={err("/spec/selector")}>
            {() => (
              <KeyValueEditor
                value={svc.spec.selector.matchLabels ?? {}}
                addLabel="Add label"
                keyPlaceholder="app"
                valuePlaceholder="web"
                onChange={(matchLabels) => setSvc({ ...svc, spec: { ...svc.spec, selector: { ...svc.spec.selector, matchLabels } } })}
              />
            )}
          </Field>
          <div className="grid content-start gap-2">
            <div className="text-sm font-medium">Matching VMs {preview.isFetching && <Spinner className="ml-1 inline size-3" />}</div>
            {preview.data?.vms.length === 0 && <p className="text-muted-foreground text-sm">No VM matches this selector.</p>}
            <ul className="grid max-h-64 gap-1.5 overflow-auto">
              {preview.data?.vms.map((v) => (
                <li key={v.name} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  {v.eligible ? <CheckCircle2 className="text-success size-4" /> : <XCircle className="text-muted-foreground size-4" />}
                  <span className="truncate">{v.displayName}</span>
                  <span className="text-muted-foreground ml-auto font-mono text-xs">{v.ip ?? v.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={<Server className="size-4" />}
        title="Ports"
        description="TCP pass-through; TLS is end-to-end between client and guest"
        aside={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ports.length >= 16}
            onClick={() => setPorts([...ports, { name: `port${ports.length + 1}`, port: 8080, protocol: "TCP" }])}
          >
            <Plus /> Add port
          </Button>
        }
      >
        {err("/spec/ports") && ports.length === 0 && <p className="text-destructive text-xs">{err("/spec/ports")}</p>}
        {ports.map((p, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_120px_120px_auto]">
            <Field label="Name" error={err(`/spec/ports/${i}/name`)}>
              {(id) => (
                <Input
                  id={id}
                  value={p.name ?? ""}
                  onChange={(e) => setPorts(ports.map((x, j) => (j === i ? { ...x, name: e.target.value || undefined } : x)))}
                />
              )}
            </Field>
            <Field label="Port" error={err(`/spec/ports/${i}/port`)}>
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  max={65535}
                  value={p.port}
                  onChange={(v) => setPorts(ports.map((x, j) => (j === i ? { ...x, port: v ?? 0 } : x)))}
                />
              )}
            </Field>
            <Field label="Target port">
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  max={65535}
                  placeholder={String(p.port)}
                  value={p.targetPort}
                  onChange={(v) => setPorts(ports.map((x, j) => (j === i ? { ...x, targetPort: v } : x)))}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={ports.length <= 1}
              aria-label="Remove port"
              onClick={() => setPorts(ports.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </SectionCard>

      <SectionCard
        icon={<Server className="size-4" />}
        title="Endpoint probing"
        description="Optional TCP reachability checks that remove unreachable VMs from serving"
        aside={
          <Switch
            checked={!!probe?.enabled}
            onCheckedChange={(v) => setSvc({ ...svc, spec: { ...svc.spec, endpointProbe: v ? { ...probe, enabled: true } : undefined } })}
          />
        }
      >
        {probe?.enabled ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Dial timeout" hint="e.g. 2s">
              {(id) => (
                <Input
                  id={id}
                  placeholder="2s"
                  value={probe.dialTimeout ?? ""}
                  onChange={(e) => setSvc({ ...svc, spec: { ...svc.spec, endpointProbe: { ...probe, dialTimeout: e.target.value || undefined } } })}
                />
              )}
            </Field>
            <Field label="Failure threshold">
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  placeholder="3"
                  value={probe.demoteThreshold}
                  onChange={(v) => setSvc({ ...svc, spec: { ...svc.spec, endpointProbe: { ...probe, demoteThreshold: v } } })}
                />
              )}
            </Field>
            <Field label="Max probes per pass">
              {(id) => (
                <NumberInput
                  id={id}
                  min={1}
                  placeholder="32"
                  value={probe.maxProbesPerReconcile}
                  onChange={(v) => setSvc({ ...svc, spec: { ...svc.spec, endpointProbe: { ...probe, maxProbesPerReconcile: v } } })}
                />
              )}
            </Field>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Disabled: readiness is based on power state and IP address only.</p>
        )}
      </SectionCard>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setTouched(true);
            if (validateVirtualMachineService(svc).length) return;
            setBusy(true);
            try {
              await onSubmit(svc);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />} {mode === "create" ? "Create service" : "Save"}
        </Button>
      </div>
    </div>
  );
}
