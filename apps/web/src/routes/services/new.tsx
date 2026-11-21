import type { VirtualMachineService } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { toast } from "sonner";
import { Page, PageHeader } from "@/components/page";
import { CreateDenied, useCreateTargets } from "@/components/workspace-select";
import { emptyService, ServiceForm } from "@/features/services/service-form";
import { api, errorMessage, unwrap } from "@/lib/api";

export const Route = createFileRoute("/services/new")({ component: NewServicePage });

function NewServicePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const targets = useCreateTargets("virtualmachineservices");
  const m = useMutation({
    mutationFn: (s: VirtualMachineService) =>
      unwrap(api.namespaces[":ns"].services.$post({ param: { ns: s.metadata.namespace as string }, query: {}, json: s })),
    onSuccess: (s) => {
      toast.success(`Service ${s.metadata.name} created`);
      void qc.invalidateQueries({ queryKey: ["services"] });
      void navigate({ to: "/services/$ns/$name", params: { ns: s.metadata.namespace as string, name: s.metadata.name as string } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!targets.workspaces.length)
    return (
      <Page>
        <CreateDenied what="VM services" workspace={targets.denied} />
      </Page>
    );
  const ns = targets.workspaces[0]?.namespace as string;
  return (
    <Page className="max-w-5xl">
      <PageHeader icon={<Network className="size-5" />} title="Create VM service" />
      <ServiceForm
        initial={emptyService(ns)}
        mode="create"
        workspaces={targets.workspaces}
        serverError={m.error}
        onSubmit={(s) => m.mutateAsync(s)}
        onCancel={() => navigate({ to: "/services" })}
      />
    </Page>
  );
}
