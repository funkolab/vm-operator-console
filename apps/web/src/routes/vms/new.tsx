import { ApiVersions, cleanVMForCopy, type VirtualMachine } from "@console/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState, LoadingState, Page, PageHeader } from "@/components/page";
import { VMForm } from "@/features/vms/vm-form";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ALL, useNamespace } from "@/lib/namespace";
import { useNamespacesWith, vmQuery } from "@/lib/queries";

export const Route = createFileRoute("/vms/new")({
  validateSearch: z.object({ from: z.string().optional() }),
  component: NewVMPage,
});

function blankVM(ns: string): VirtualMachine {
  return {
    apiVersion: ApiVersions.vmm,
    kind: "VirtualMachine",
    metadata: { name: "", namespace: ns, labels: {} },
    spec: {
      placement: { cluster: { type: "name", name: "" } },
      compute: { numSockets: 2, numCoresPerSocket: 1, memorySize: "4Gi" },
      bootConfiguration: { bootType: "uefi", bootDisk: { source: { type: "Image", image: { type: "name", name: "" } }, diskSize: "40Gi" } },
      network: { nics: [{ name: "nic0", networkInfo: { nicType: "NORMAL_NIC", subnet: { type: "name", name: "" } } }] },
      powerState: "On",
    },
  };
}

function NewVMPage() {
  const { from } = Route.useSearch();
  const scope = useNamespace();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const namespaces = useNamespacesWith("virtualmachines", "create");
  const [srcNs, srcName] = from?.split("/") ?? [];
  const src = useQuery({ ...vmQuery(srcNs ?? "", srcName ?? ""), enabled: !!from });
  const defaultNs = scope !== ALL && namespaces.includes(scope) ? scope : (namespaces[0] ?? "");

  const create = useMutation({
    mutationFn: (vm: VirtualMachine) => unwrap(api.namespaces[":ns"].vms.$post({ param: { ns: vm.metadata.namespace as string }, query: {}, json: vm })),
    onSuccess: (vm) => {
      toast.success(`VM ${vm.metadata.name} created`);
      void qc.invalidateQueries({ queryKey: ["vms"] });
      void navigate({ to: "/vms/$ns/$name", params: { ns: vm.metadata.namespace as string, name: vm.metadata.name as string } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (from && src.isLoading)
    return (
      <Page>
        <LoadingState />
      </Page>
    );
  if (from && src.error)
    return (
      <Page>
        <ErrorState error={src.error} />
      </Page>
    );
  if (!namespaces.length)
    return (
      <Page>
        <ErrorState error={new Error("You are not allowed to create VirtualMachines in any namespace.")} />
      </Page>
    );

  let initial = blankVM(defaultNs);
  if (src.data) {
    const copy = cleanVMForCopy(src.data);
    initial = {
      ...copy,
      metadata: { ...copy.metadata, name: `${srcName}-copy`, namespace: namespaces.includes(srcNs as string) ? srcNs : defaultNs },
      spec: { ...copy.spec, displayName: undefined },
    };
  }

  return (
    <Page>
      <PageHeader
        icon={<Server className="size-5" />}
        title={from ? `Clone ${srcName}` : "Create virtual machine"}
        description="Define the VM declaratively; vm-operator provisions it on Nutanix."
      />
      <VMForm
        key={from ?? "new"}
        initial={initial}
        namespaces={namespaces}
        mode="create"
        submitLabel="Create VM"
        serverError={create.error}
        onSubmit={(vm) => create.mutateAsync(vm)}
        onCancel={() => navigate({ to: "/vms" })}
      />
    </Page>
  );
}
