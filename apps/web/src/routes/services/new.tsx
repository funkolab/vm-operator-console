import type { VirtualMachineService } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, Page, PageHeader } from "@/components/page";
import { emptyService, ServiceForm } from "@/features/services/service-form";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ALL, useNamespace } from "@/lib/namespace";
import { useNamespacesWith } from "@/lib/queries";

export const Route = createFileRoute("/services/new")({ component: NewServicePage });

function NewServicePage() {
  const scope = useNamespace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const namespaces = useNamespacesWith("virtualmachineservices", "create");
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
  if (!namespaces.length)
    return (
      <Page>
        <ErrorState error={new Error("You are not allowed to create VM services in any namespace.")} />
      </Page>
    );
  const ns = scope !== ALL && namespaces.includes(scope) ? scope : (namespaces[0] as string);
  return (
    <Page className="max-w-5xl">
      <PageHeader icon={<Network className="size-5" />} title="Create VM service" />
      <ServiceForm
        initial={emptyService(ns)}
        mode="create"
        namespaces={namespaces}
        serverError={m.error}
        onSubmit={(s) => m.mutateAsync(s)}
        onCancel={() => navigate({ to: "/services" })}
      />
    </Page>
  );
}
