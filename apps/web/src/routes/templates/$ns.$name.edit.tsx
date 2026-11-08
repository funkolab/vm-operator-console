import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { type TemplateDraft, TemplateEditor } from "@/features/templates/template-editor";
import { api, errorMessage, unwrap } from "@/lib/api";
import { templateQuery } from "@/lib/queries";

export const Route = createFileRoute("/templates/$ns/$name/edit")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(templateQuery(params.ns, params.name)),
  pendingComponent: () => (
    <Page>
      <LoadingState rows={8} />
    </Page>
  ),
  errorComponent: ({ error }) => (
    <Page>
      <ErrorState error={error} />
    </Page>
  ),
  component: EditTemplatePage,
});

function EditTemplatePage() {
  const { ns, name } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ ...templateQuery(ns, name), staleTime: Number.POSITIVE_INFINITY });
  const m = useMutation({
    mutationFn: (t: TemplateDraft) =>
      unwrap(api.namespaces[":ns"].templates[":name"].$put({ param: { ns, name }, json: { ...t, resourceVersion: q.data?.resourceVersion } })),
    onSuccess: (t) => {
      toast.success(`Template ${t.displayName} saved`);
      qc.setQueryData(["template", ns, name], t);
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void navigate({ to: "/templates/$ns/$name", params: { ns, name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  return (
    <Page>
      <PageHeader
        icon={<Pencil className="size-5" />}
        title={`Edit ${q.data.displayName}`}
        description={
          <span className="font-mono">
            {ns}/vmt-{name}
          </span>
        }
      />
      <TemplateEditor
        initial={q.data}
        mode="edit"
        namespaces={[ns]}
        serverError={m.error}
        onSubmit={(t) => m.mutateAsync(t)}
        onCancel={() => navigate({ to: "/templates/$ns/$name", params: { ns, name } })}
      />
    </Page>
  );
}
