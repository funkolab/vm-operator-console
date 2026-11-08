import type { VirtualMachine } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { VMForm } from "@/features/vms/vm-form";
import { ApiError, api, errorMessage, unwrap } from "@/lib/api";
import { vmQuery } from "@/lib/queries";

export const Route = createFileRoute("/vms/$ns/$name/edit")({
  // Always start editing from the latest server version (not a possibly stale cache entry).
  loader: ({ context, params }) => context.queryClient.fetchQuery({ ...vmQuery(params.ns, params.name), staleTime: 0 }),
  pendingComponent: () => (
    <Page>
      <LoadingState rows={8} />
    </Page>
  ),
  component: EditVMPage,
});

function EditVMPage() {
  const { ns, name } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery(vmQuery(ns, name));
  // Snapshot the VM at edit start; live updates must not overwrite the user's edits.
  const [snapshot, setSnapshot] = useState<VirtualMachine | undefined>(q.data);
  const [formKey, setFormKey] = useState(0);
  const update = useMutation({
    mutationFn: ({ vm, opts }: { vm: VirtualMachine; opts: { confirmDiskDeletion?: boolean; confirmBootDiskDeletion?: boolean } }) =>
      unwrap(
        api.namespaces[":ns"].vms[":name"].$put({
          param: { ns, name },
          query: {
            confirmDiskDeletion: opts.confirmDiskDeletion ? "true" : undefined,
            confirmBootDiskDeletion: opts.confirmBootDiskDeletion ? "true" : undefined,
          },
          json: vm,
        }),
      ),
    onSuccess: (vm) => {
      qc.setQueryData(["vm", ns, name], vm);
      toast.success(`Changes to ${name} applied`);
      void navigate({ to: "/vms/$ns/$name", params: { ns, name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!snapshot) return <Page>{q.error ? <ErrorState error={q.error} /> : <LoadingState />}</Page>;
  const conflict = update.error instanceof ApiError && update.error.status === 409;
  const stale = q.data && q.data.metadata.resourceVersion !== snapshot.metadata.resourceVersion && q.data.metadata.generation !== snapshot.metadata.generation;

  return (
    <Page>
      <PageHeader
        icon={<Pencil className="size-5" />}
        title={`Edit ${snapshot.spec.displayName || name}`}
        description={
          <span className="font-mono">
            {ns}/{name}
          </span>
        }
      />
      {(conflict || stale) && (
        <Alert className="border-warning/30 bg-warning/5">
          <RefreshCw className="text-warning" />
          <AlertTitle>This VM was modified by someone else</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Reload the latest version to continue. Your unsaved changes will be lost.
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSnapshot(q.data);
                setFormKey((k) => k + 1);
                update.reset();
              }}
            >
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <VMForm
        key={formKey}
        initial={snapshot}
        original={snapshot}
        namespaces={[ns]}
        mode="edit"
        submitLabel="Apply changes"
        serverError={update.error}
        onSubmit={(vm, opts) => update.mutateAsync({ vm, opts })}
        onCancel={() => navigate({ to: "/vms/$ns/$name", params: { ns, name } })}
      />
    </Page>
  );
}
