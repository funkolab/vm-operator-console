import { DNS1123_LABEL, type TestConnectionResult } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, KeyRound, Lock, PlugZap, ServerCog, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Field, NumberInput } from "@/components/form";
import { ErrorState, Page, PageHeader, Spinner } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Credential, CredentialFields } from "@/features/contexts/credential-fields";
import { SectionCard } from "@/features/vms/spec-editor";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ALL, useNamespace } from "@/lib/namespace";
import { credentialSecretsQuery, useCan, useNamespacesWith } from "@/lib/queries";

export const Route = createFileRoute("/contexts/new")({ component: NewContextPage });

function NewContextPage() {
  const scope = useNamespace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useCan();
  const namespaces = useNamespacesWith("nutanixprismcontexts", "create");
  const [ns, setNs] = useState(scope !== ALL && namespaces.includes(scope) ? scope : (namespaces[0] ?? ""));
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState<number | undefined>(9440);
  const [tlsMode, setTlsMode] = useState<"Secure" | "Insecure">("Secure");
  const [caBundle, setCaBundle] = useState("");
  const [credSource, setCredSource] = useState<"new" | "existing">("new");
  const [cred, setCred] = useState<Credential>({ mode: "basic", username: "", password: "" });
  const [existing, setExisting] = useState("");
  const [projectMode, setProjectMode] = useState<"default" | "name">("default");
  const [project, setProject] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [test, setTest] = useState<TestConnectionResult>();
  const secrets = useQuery({ ...credentialSecretsQuery(ns), enabled: !!ns && credSource === "existing" });
  const canWriteSecrets = can(ns, "secrets", "create");

  const testM = useMutation({
    mutationFn: () => unwrap(api.contexts.test.$post({ json: { address, port: port ?? 9440, tlsMode, caBundle: caBundle || undefined, credential: cred } })),
    onSuccess: setTest,
    onError: (e) => setTest({ ok: false, message: errorMessage(e) }),
  });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"].contexts.$post({
          param: { ns },
          json: {
            name,
            address,
            port: port ?? 9440,
            tlsMode,
            caBundle: tlsMode === "Secure" ? caBundle : undefined,
            project: projectMode === "default" ? undefined : { type: "name", name: project },
            credential: credSource === "existing" ? { mode: "existing", secretName: existing } : cred,
          },
        }),
      ),
    onSuccess: (c) => {
      toast.success(`Prism Central account ${c.metadata.name} created`);
      void qc.invalidateQueries({ queryKey: ["contexts"] });
      void navigate({ to: "/contexts/$ns/$name", params: { ns, name: c.metadata.name as string } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!namespaces.length)
    return (
      <Page>
        <ErrorState error={new Error("You are not allowed to create Prism Central contexts in any namespace.")} />
      </Page>
    );
  const credOk = credSource === "existing" ? !!existing : cred.mode === "basic" ? !!cred.username && !!cred.password : !!cred.apiKey;
  const valid = DNS1123_LABEL.test(name) && !!address && credOk && (tlsMode === "Insecure" || !!caBundle.trim()) && (projectMode === "default" || !!project);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        icon={<ServerCog className="size-5" />}
        title="Add Prism Central account"
        description="Creates a NutanixPrismContext, its credential Secret and CA bundle with your permissions."
      />
      <SectionCard icon={<ServerCog className="size-4" />} title="Endpoint">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={submitted && !DNS1123_LABEL.test(name) ? "Lowercase letters, digits and '-'" : undefined}>
            {(id) => <Input id={id} value={name} placeholder="pc-prod" onChange={(e) => setName(e.target.value.toLowerCase())} />}
          </Field>
          <Field label="Namespace" required hint="VMs use contexts from their own namespace">
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
          <Field label="Address" required doc="NutanixPrismContext/spec/endpoint/address" error={submitted && !address ? "Required" : undefined}>
            {(id) => <Input id={id} value={address} placeholder="prism-central.example.com" onChange={(e) => setAddress(e.target.value.trim())} />}
          </Field>
          <Field label="Port">{(id) => <NumberInput id={id} min={1} max={65535} value={port} onChange={setPort} />}</Field>
          <Field label="TLS verification" className="sm:col-span-2">
            {() => (
              <ToggleGroup type="single" variant="outline" value={tlsMode} onValueChange={(v) => v && setTlsMode(v as "Secure")} className="justify-start">
                <ToggleGroupItem value="Secure" className="px-3">
                  <Lock /> Verify with CA bundle
                </ToggleGroupItem>
                <ToggleGroupItem value="Insecure" className="px-3">
                  Skip verification
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </Field>
          {tlsMode === "Secure" && (
            <Field
              label="CA bundle (PEM)"
              required
              className="sm:col-span-2"
              error={submitted && !caBundle.trim() ? "Required in Secure mode" : undefined}
              hint="Stored in a ConfigMap under the key ca.crt"
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={5}
                  className="font-mono text-xs"
                  placeholder="-----BEGIN CERTIFICATE-----"
                  value={caBundle}
                  onChange={(e) => setCaBundle(e.target.value)}
                />
              )}
            </Field>
          )}
          {tlsMode === "Insecure" && (
            <Alert className="border-warning/30 bg-warning/5 sm:col-span-2">
              <AlertDescription>Certificate verification is disabled. Use only for lab environments.</AlertDescription>
            </Alert>
          )}
        </div>
      </SectionCard>
      <SectionCard icon={<KeyRound className="size-4" />} title="Credentials" description="Stored in a Kubernetes Secret; never displayed again">
        <ToggleGroup type="single" variant="outline" value={credSource} onValueChange={(v) => v && setCredSource(v as "new")} className="justify-start">
          <ToggleGroupItem value="new" className="px-3" disabled={!canWriteSecrets}>
            New credentials
          </ToggleGroupItem>
          <ToggleGroupItem value="existing" className="px-3">
            Existing Secret
          </ToggleGroupItem>
        </ToggleGroup>
        {credSource === "new" ? (
          <>
            <CredentialFields value={cred} onChange={setCred} showErrors={submitted} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled={!address || !credOk || testM.isPending} onClick={() => testM.mutate()}>
                {testM.isPending ? <Spinner /> : <PlugZap />} Test connection
              </Button>
              {test && (
                <span className={`flex items-center gap-1.5 text-sm ${test.ok ? "text-success" : "text-destructive"}`}>
                  {test.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {test.message}
                  {test.pcVersion && ` · ${test.pcVersion}`}
                  {test.latencyMs !== undefined && <span className="text-muted-foreground">({test.latencyMs} ms)</span>}
                </span>
              )}
            </div>
          </>
        ) : (
          <Field label="Secret" required hint="Secrets labelled as Prism credentials in this namespace" error={submitted && !existing ? "Required" : undefined}>
            {(id) => (
              <Select value={existing} onValueChange={setExisting}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue placeholder={secrets.isLoading ? "Loading…" : "Select a Secret"} />
                </SelectTrigger>
                <SelectContent>
                  {(secrets.data ?? []).map((s) => (
                    <SelectItem key={s.name} value={s.name as string}>
                      {s.name} <span className="text-muted-foreground">({s.mode === "apiKey" ? "API key" : s.username})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        )}
      </SectionCard>
      <SectionCard
        icon={<ServerCog className="size-4" />}
        title="Project"
        description="Optional. Immutable once created; defaults to the Prism Central default project"
      >
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <Select value={projectMode} onValueChange={(v) => setProjectMode(v as "default")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default project</SelectItem>
              <SelectItem value="name">By name</SelectItem>
            </SelectContent>
          </Select>
          {projectMode !== "default" && <Input value={project} placeholder="project name" onChange={(e) => setProject(e.target.value.trim())} />}
        </div>
      </SectionCard>
      {create.error && (
        <Alert variant="destructive">
          <AlertTitle>Could not create the account</AlertTitle>
          <AlertDescription>{errorMessage(create.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate({ to: "/contexts" })}>
          Cancel
        </Button>
        <Button
          disabled={create.isPending}
          onClick={() => {
            setSubmitted(true);
            if (valid) create.mutate();
          }}
        >
          {create.isPending && <Spinner />} Create account
        </Button>
      </div>
    </Page>
  );
}
