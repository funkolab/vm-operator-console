import { ApiVersions } from "@console/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { type TemplateDraft, TemplateEditor } from "@/features/templates/template-editor";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useNamespace } from "@/lib/namespace";
import { useNamespacesWith, usePreferredNamespace } from "@/lib/queries";

export const Route = createFileRoute("/templates/new")({ component: NewTemplatePage });

function NewTemplatePage() {
  const scope = useNamespace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const namespaces = useNamespacesWith("configmaps", "create");
  const preferred = usePreferredNamespace(namespaces, scope);
  const m = useMutation({
    mutationFn: (t: TemplateDraft) => unwrap(api.namespaces[":ns"].templates.$post({ param: { ns: t.namespace }, query: {}, json: t })),
    onSuccess: (t) => {
      toast.success(`Template ${t.displayName} created`);
      void qc.invalidateQueries({ queryKey: ["templates"] });
      void navigate({ to: "/templates/$ns/$name", params: { ns: t.namespace, name: t.name } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!namespaces.length)
    return (
      <Page>
        <ErrorState error={new Error("You are not allowed to create templates (ConfigMaps) in any namespace.")} />
      </Page>
    );
  if (preferred.loading)
    return (
      <Page>
        <LoadingState />
      </Page>
    );
  const initial: TemplateDraft = {
    name: "",
    namespace: preferred.namespace,
    displayName: "",
    tags: [],
    osType: "Linux",
    parameters: [
      { name: "cluster", label: "Cluster", path: "/spec/placement/cluster", type: "clusterRef", required: true },
      { name: "memory", label: "Memory", path: "/spec/compute/memorySize", type: "quantity", min: "1Gi", max: "256Gi" },
    ],
    vm: {
      apiVersion: ApiVersions.vmm,
      kind: "VirtualMachine",
      metadata: {},
      spec: {
        placement: { cluster: { type: "name", name: "" } },
        compute: { numSockets: 2, numCoresPerSocket: 1, memorySize: "4Gi" },
        bootConfiguration: { bootType: "uefi", bootDisk: { source: { type: "Image", image: { type: "name", name: "" } }, diskSize: "40Gi" } },
        network: { nics: [{ name: "nic0", networkInfo: { nicType: "NORMAL_NIC", subnet: { type: "name", name: "" } } }] },
        powerState: "On",
      },
    },
  };
  return (
    <Page>
      <PageHeader
        icon={<LayoutTemplate className="size-5" />}
        title="New template"
        description="Define a reusable VM configuration and the values asked at deploy time."
      />
      <TemplateEditor
        initial={initial}
        mode="create"
        namespaces={namespaces}
        serverError={m.error}
        onSubmit={(t) => m.mutateAsync(t)}
        onCancel={() => navigate({ to: "/templates" })}
      />
    </Page>
  );
}
