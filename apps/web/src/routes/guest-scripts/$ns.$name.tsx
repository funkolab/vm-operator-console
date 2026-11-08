import { GUEST_SCRIPT_KEYS, GUEST_SCRIPT_LABELS } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Copy, Download, EyeOff, FileCode2, Pencil, Save, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field } from "@/components/form";
import { DescriptionList, EmptyState, ErrorState, LoadingState, Page, PageHeader, Section, Spinner } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewScriptDialog } from "@/features/guest-scripts/new-script-dialog";
import { hasErrors, ScriptEditor, scriptIssues } from "@/features/guest-scripts/script-editor";
import { api, errorMessage, unwrap } from "@/lib/api";
import { downloadText, formatDate, relativeTime } from "@/lib/format";
import { guestScriptQuery, useCan } from "@/lib/queries";
import { EngineBadge } from "./index";

export const Route = createFileRoute("/guest-scripts/$ns/$name")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(guestScriptQuery(params.ns, params.name)),
  pendingComponent: () => (
    <Page>
      <LoadingState rows={8} />
    </Page>
  ),
  errorComponent: ({ error, reset }) => (
    <Page>
      <ErrorState error={error} onRetry={reset} />
    </Page>
  ),
  component: GuestScriptPage,
});

function GuestScriptPage() {
  const { ns, name } = Route.useParams();
  const can = useCan();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery(guestScriptQuery(ns, name));
  const [draft, setDraft] = useState<{ content: string; description: string } | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const editing = !!draft;
  const dirty = !!draft && !!q.data && (draft.content !== q.data.content || draft.description !== (q.data.description ?? ""));
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm("Discard your unsaved changes to this script?"), enableBeforeUnload: () => dirty });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.namespaces[":ns"]["guest-secrets"][":name"].$put({
          param: { ns, name },
          json: {
            type: q.data?.type ?? "CloudInit",
            content: draft?.content ?? "",
            description: draft?.description.trim() || undefined,
            resourceVersion: q.data?.resourceVersion,
          },
        }),
      ),
    onSuccess: (s) => {
      qc.setQueryData(guestScriptQuery(ns, name).queryKey, s);
      void qc.invalidateQueries({ queryKey: ["guest-secrets"] });
      setDraft(undefined);
      toast.success(`Script ${name} saved`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => unwrap(api.namespaces[":ns"]["guest-secrets"][":name"].$delete({ param: { ns, name } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["guest-secrets"] });
      toast.success(`Script ${name} deleted`);
      void navigate({ to: "/guest-scripts" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const s = q.data;
  const readable = s.content !== undefined;
  const canEdit = readable && can(ns, "secrets", "update");
  const users = s.usage.vms.length + s.usage.templates.length;
  const provisioned = s.usage.vms.filter((v) => v.provisioned).length;
  const content = draft?.content ?? s.content ?? "";
  const invalid = editing && hasErrors(scriptIssues(s.type, content));
  const ext = s.type === "CloudInit" ? "yaml" : "xml";

  return (
    <Page>
      <div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground -ml-2 mb-2">
          <Link to="/guest-scripts">
            <ArrowLeft /> Guest scripts
          </Link>
        </Button>
        <PageHeader
          icon={<FileCode2 className="size-5" />}
          title={name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{ns}</span>
              <EngineBadge type={s.type} />
            </span>
          }
          actions={
            editing ? (
              <>
                <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => setDraft(undefined)}>
                  <Undo2 /> Cancel
                </Button>
                <Button size="sm" disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? <Spinner /> : <Save />} Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" disabled={!readable} onClick={() => downloadText(`${name}.${ext}`, s.content ?? "", "text/plain")}>
                  <Download /> Download
                </Button>
                <Button variant="outline" size="sm" disabled={!readable || !can(ns, "secrets", "create")} onClick={() => setDuplicate(true)}>
                  <Copy /> Duplicate
                </Button>
                <Button variant="outline" size="sm" disabled={!can(ns, "secrets", "delete")} onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete
                </Button>
                <Button size="sm" disabled={!canEdit} onClick={() => setDraft({ content: s.content ?? "", description: s.description ?? "" })}>
                  <Pencil /> Edit
                </Button>
              </>
            )
          }
        />
      </div>

      {editing && provisioned > 0 && (
        <Alert>
          <AlertTitle>Only new VMs get the change</AlertTitle>
          <AlertDescription>
            Guest customization runs once, at first boot. The {provisioned} VM{provisioned > 1 ? "s" : ""} already provisioned with this script keep their
            current configuration.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section title={GUEST_SCRIPT_LABELS[s.type] === "Sysprep" ? "Unattend.xml" : "Cloud-config"} description={`Secret key ${GUEST_SCRIPT_KEYS[s.type]}`}>
          {editing && (
            <Field label="Description" className="mb-4">
              {(id) => (
                <Input
                  id={id}
                  value={draft.description}
                  maxLength={500}
                  placeholder="What this script sets up"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              )}
            </Field>
          )}
          {readable ? (
            <ScriptEditor type={s.type} value={content} readOnly={!editing} onChange={(v) => setDraft(draft && { ...draft, content: v })} minHeight="420px" />
          ) : (
            <EmptyState
              icon={<EyeOff className="size-6" />}
              title="Content hidden"
              description="You can see that this script exists, but your role does not allow reading Secrets in this namespace."
              className="py-10"
            />
          )}
        </Section>

        <div className="grid content-start gap-5">
          <Section title="Details">
            <DescriptionList
              items={[
                { label: "Description", value: s.description ?? "—", hidden: editing },
                { label: "Size", value: s.sizeBytes < 1024 ? `${s.sizeBytes} B` : `${(s.sizeBytes / 1024).toFixed(1)} KiB` },
                {
                  label: "Updated",
                  value: <span title={formatDate(s.updatedAt)}>{`${relativeTime(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ""}`}</span>,
                  hidden: !s.updatedAt,
                },
                { label: "Created by", value: s.createdBy ?? "—", hidden: !s.createdBy },
              ]}
            />
          </Section>
          <Section title="Used by">
            {users === 0 ? (
              <p className="text-muted-foreground text-sm">Not referenced by any VM or template in this namespace.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {s.usage.templates.map((t) => (
                  <li key={`t-${t.name}`} className="flex items-center justify-between gap-2">
                    <Link to="/templates/$ns/$name" params={{ ns, name: t.name }} className="truncate hover:underline">
                      {t.displayName}
                    </Link>
                    <Badge variant="secondary" className="font-normal">
                      template
                    </Badge>
                  </li>
                ))}
                {s.usage.vms.map((v) => (
                  <li key={`v-${v.name}`} className="flex items-center justify-between gap-2">
                    <Link to="/vms/$ns/$name" params={{ ns, name: v.name }} className="truncate hover:underline">
                      {v.name}
                    </Link>
                    <Badge variant="outline" className="font-normal">
                      {v.provisioned ? "VM" : "VM · pending"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete script ${name}?`}
        destructive
        confirmLabel="Delete script"
        typeToConfirm={users ? name : undefined}
        description={
          users ? (
            <>
              <p>
                It is still referenced by{" "}
                {[s.usage.vms.length && `${s.usage.vms.length} VM(s)`, s.usage.templates.length && `${s.usage.templates.length} template(s)`]
                  .filter(Boolean)
                  .join(" and ")}
                .
              </p>
              <p className="mt-2">VMs not provisioned yet and VMs deployed from these templates will fail until the reference is fixed.</p>
            </>
          ) : (
            "The Secret is removed from the namespace."
          )
        }
        onConfirm={() => remove.mutateAsync()}
      />
      {duplicate && (
        <NewScriptDialog
          open={duplicate}
          onOpenChange={setDuplicate}
          namespace={ns}
          type={s.type}
          initialContent={s.content}
          onCreated={(c) => navigate({ to: "/guest-scripts/$ns/$name", params: { ns: c.namespace, name: c.name } })}
        />
      )}
    </Page>
  );
}
