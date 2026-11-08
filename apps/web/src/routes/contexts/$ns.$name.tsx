import { getCondition } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, KeyRound, Pencil, PlugZap, ServerCog, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Copyable } from "@/components/copy-button";
import { Field, NumberInput } from "@/components/form";
import { DescriptionList, ErrorState, LoadingState, Page, PageHeader, Section, Spinner } from "@/components/page";
import { ConditionList, ReadyBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Credential, CredentialFields } from "@/features/contexts/credential-fields";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { contextQuery, useCan } from "@/lib/queries";

export const Route = createFileRoute("/contexts/$ns/$name")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(contextQuery(params.ns, params.name)),
  pendingComponent: () => (
    <Page>
      <LoadingState />
    </Page>
  ),
  errorComponent: ({ error }) => (
    <Page>
      <ErrorState error={error} />
    </Page>
  ),
  component: ContextDetailPage,
});

function ContextDetailPage() {
  const { ns, name } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(contextQuery(ns, name));
  const usage = useQuery({
    queryKey: ["context-usage", ns, name],
    queryFn: () => unwrap(api.namespaces[":ns"].contexts[":name"].usage.$get({ param: { ns, name } })),
  });
  const [rotate, setRotate] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const test = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].contexts[":name"].test.$post({ param: { ns, name } })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (force: boolean) =>
      unwrap(api.namespaces[":ns"].contexts[":name"].$delete({ param: { ns, name }, query: { force: force ? "true" : undefined } })),
    onSuccess: () => {
      toast.success(`Context ${name} deleted`);
      void qc.invalidateQueries({ queryKey: ["contexts"] });
      void navigate({ to: "/contexts" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const c = q.data;
  const connected = getCondition(c.status?.conditions, "Connected");
  const cred = c.credentialInfo;
  const usedBy = usage.data?.vms ?? [];

  return (
    <Page>
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-2">
          <Link to="/contexts">
            <ArrowLeft /> Prism Central
          </Link>
        </Button>
        <PageHeader
          icon={<ServerCog className="size-5" />}
          title={
            <span className="flex items-center gap-2">
              {name} <ReadyBadge status={connected?.status} reason={connected?.status === "True" ? "Connected" : connected?.reason} />
            </span>
          }
          description={<span className="font-mono">{ns}</span>}
          actions={
            <>
              <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
                {test.isPending ? <Spinner /> : <PlugZap />} Test connection
              </Button>
              <Button variant="outline" size="sm" disabled={!can(ns, "nutanixprismcontexts", "patch")} onClick={() => setEdit(true)}>
                <Pencil /> Edit endpoint
              </Button>
              <Button variant="outline" size="sm" disabled={!can(ns, "secrets", "update")} onClick={() => setRotate(true)}>
                <KeyRound /> Rotate credentials
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!can(ns, "nutanixprismcontexts", "delete")}
                onClick={() => setDel(true)}
              >
                <Trash2 /> Delete
              </Button>
            </>
          }
        />
      </div>
      {test.data && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${test.data.ok ? "border-success/30 text-success" : "border-destructive/30 text-destructive"}`}
        >
          {test.data.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {test.data.message}
          {test.data.pcVersion && ` · ${test.data.pcVersion}`}
          {test.data.latencyMs !== undefined && <span className="text-muted-foreground">({test.data.latencyMs} ms)</span>}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Connection">
          <DescriptionList
            items={[
              { label: "Endpoint", value: <Copyable value={`${c.spec.endpoint.address}:${c.spec.endpoint.port ?? 9440}`} /> },
              {
                label: "TLS",
                value:
                  c.spec.endpoint.tls.mode === "Secure" ? (
                    `Verified (CA ConfigMap ${c.spec.endpoint.tls.caBundleRef?.name})`
                  ) : (
                    <Badge variant="outline" className="text-warning border-warning/40">
                      Verification disabled
                    </Badge>
                  ),
              },
              { label: "PC version", value: c.status?.pcVersion ?? "—" },
              {
                label: "Project",
                value: c.status?.project
                  ? `${c.status.project.name ?? c.status.project.extId}${c.status.project.isDefault ? " (default)" : ""}`
                  : (c.spec.project?.name ?? c.spec.project?.extId ?? "Default"),
              },
              { label: "Credential", value: cred ? `${cred.secretNamespace}/${cred.secretName}` : "—" },
              {
                label: "Authentication",
                value: cred?.exists ? (
                  cred.mode === "apiKey" ? (
                    "API key"
                  ) : (
                    `User ${cred.username}`
                  )
                ) : (
                  <span className="text-destructive">Secret not found or not readable</span>
                ),
              },
              { label: "Credential updated", value: cred?.updatedAt ? relativeTime(cred.updatedAt) : "—" },
              { label: "Created", value: formatDate(c.metadata.creationTimestamp) },
            ]}
          />
        </Section>
        <Section title="Conditions">
          <ConditionList conditions={c.status?.conditions} order={["Ready", "Connected"]} />
        </Section>
        <Section title={`Used by ${usedBy.length} VM(s)`} className="lg:col-span-2">
          {usedBy.length === 0 ? (
            <p className="text-muted-foreground text-sm">No VM uses this context.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {usedBy.map((v) => (
                <Link key={v} to="/vms/$ns/$name" params={{ ns, name: v }}>
                  <Badge variant="secondary" className="hover:bg-accent">
                    {v}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Section>
      </div>
      <RotateDialog open={rotate} onOpenChange={setRotate} ns={ns} name={name} initialMode={cred?.mode} />
      {edit && <EditEndpointDialog open={edit} onOpenChange={setEdit} ctx={c} />}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        destructive
        title={`Delete ${name}?`}
        typeToConfirm={usedBy.length ? name : undefined}
        confirmLabel="Delete context"
        description={
          usedBy.length
            ? `${usedBy.length} VM(s) use this context and will no longer be reconciled. Console-managed credential Secrets and CA ConfigMaps are deleted with it.`
            : "Console-managed credential Secrets and CA ConfigMaps are deleted with it."
        }
        onConfirm={() => remove.mutateAsync(usedBy.length > 0)}
      />
    </Page>
  );
}

function RotateDialog({
  open,
  onOpenChange,
  ns,
  name,
  initialMode,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ns: string;
  name: string;
  initialMode?: "basic" | "apiKey";
}) {
  const qc = useQueryClient();
  const [cred, setCred] = useState<Credential>(initialMode === "apiKey" ? { mode: "apiKey", apiKey: "" } : { mode: "basic", username: "", password: "" });
  const ok = cred.mode === "basic" ? !!cred.username && !!cred.password : !!cred.apiKey;
  const m = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"].contexts[":name"].credential.$put({ param: { ns, name }, json: cred })),
    onSuccess: () => {
      toast.success("Credentials rotated; the operator reconnects automatically");
      void qc.invalidateQueries({ queryKey: ["context", ns, name] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate credentials</DialogTitle>
          <DialogDescription>The referenced Secret is overwritten. Other contexts sharing it are affected too.</DialogDescription>
        </DialogHeader>
        <CredentialFields value={cred} onChange={setCred} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ok || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Rotate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditEndpointDialog({
  open,
  onOpenChange,
  ctx,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: NonNullable<ReturnType<typeof useQuery<Awaited<ReturnType<NonNullable<ReturnType<typeof contextQuery>["queryFn"]>>>>>["data"]>;
}) {
  const qc = useQueryClient();
  const ns = ctx.metadata.namespace as string;
  const name = ctx.metadata.name as string;
  const [address, setAddress] = useState(ctx.spec.endpoint.address);
  const [port, setPort] = useState<number | undefined>(ctx.spec.endpoint.port ?? 9440);
  const [tlsMode, setTlsMode] = useState<"Secure" | "Insecure">(ctx.spec.endpoint.tls.mode);
  const [caBundle, setCaBundle] = useState("");
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].contexts[":name"].$patch({
          param: { ns, name },
          json: { address, port: port ?? 9440, tlsMode, caBundle: caBundle || undefined, resourceVersion: ctx.metadata.resourceVersion },
        }),
      ),
    onSuccess: () => {
      toast.success("Endpoint updated");
      void qc.invalidateQueries({ queryKey: ["context", ns, name] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit endpoint</DialogTitle>
          <DialogDescription>The project cannot be changed; create a new context instead.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Address">{(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value.trim())} />}</Field>
            <Field label="Port">{(id) => <NumberInput id={id} value={port} onChange={setPort} />}</Field>
          </div>
          <ToggleGroup type="single" variant="outline" value={tlsMode} onValueChange={(v) => v && setTlsMode(v as "Secure")} className="justify-start">
            <ToggleGroupItem value="Secure" className="px-3">
              Verify TLS
            </ToggleGroupItem>
            <ToggleGroupItem value="Insecure" className="px-3">
              Skip verification
            </ToggleGroupItem>
          </ToggleGroup>
          {tlsMode === "Secure" && (
            <Field label="CA bundle (PEM)" hint={ctx.spec.endpoint.tls.caBundleRef ? "Leave empty to keep the current bundle" : "Required"}>
              {(id) => <Textarea id={id} rows={4} className="font-mono text-xs" value={caBundle} onChange={(e) => setCaBundle(e.target.value)} />}
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!address || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
