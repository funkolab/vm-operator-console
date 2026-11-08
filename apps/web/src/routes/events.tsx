import { eventTimestamp } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, AlertTriangle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ErrorState, LoadingState, Page, PageHeader, Section } from "@/components/page";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EventList } from "@/features/events/event-list";
import { useNamespace } from "@/lib/namespace";
import { eventsQuery } from "@/lib/queries";

export const Route = createFileRoute("/events")({
  validateSearch: z.object({ type: z.enum(["all", "Warning", "Normal"]).optional(), kind: z.string().optional() }),
  component: EventsPage,
});

function EventsPage() {
  const ns = useNamespace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(eventsQuery(ns));
  const [text, setText] = useState("");
  const type = search.type ?? "all";
  const kind = search.kind ?? "all";
  const filtered = useMemo(
    () =>
      (q.data ?? [])
        .filter((e) => type === "all" || e.type === type)
        .filter((e) => kind === "all" || e.involvedObject.kind === kind)
        .filter((e) => !text || `${e.reason} ${e.message} ${e.involvedObject.name}`.toLowerCase().includes(text.toLowerCase()))
        .sort((a, b) => (eventTimestamp(b) ?? "").localeCompare(eventTimestamp(a) ?? "")),
    [q.data, type, kind, text],
  );
  const warnings = (q.data ?? []).filter((e) => e.type === "Warning").length;
  return (
    <Page>
      <PageHeader
        icon={<Activity className="size-5" />}
        title="Events"
        description="Kubernetes events emitted by vm-operator for VMs, services and Prism Central contexts (retained ~1 hour)."
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter events…" className="h-9 pl-8" />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={type}
          onValueChange={(v) => v && navigate({ search: { ...search, type: v as "all" }, replace: true })}
        >
          <ToggleGroupItem value="all" className="px-3">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="Warning" className="px-3">
            <AlertTriangle /> Warnings ({warnings})
          </ToggleGroupItem>
          <ToggleGroupItem value="Normal" className="px-3">
            Normal
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={kind}
          onValueChange={(v) => v && navigate({ search: { ...search, kind: v }, replace: true })}
        >
          <ToggleGroupItem value="all" className="px-3">
            Any kind
          </ToggleGroupItem>
          <ToggleGroupItem value="VirtualMachine" className="px-3">
            VMs
          </ToggleGroupItem>
          <ToggleGroupItem value="VirtualMachineService" className="px-3">
            Services
          </ToggleGroupItem>
          <ToggleGroupItem value="NutanixPrismContext" className="px-3">
            Prism Central
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Section
        title={`${filtered.length} event(s)`}
        actions={
          <Link to="/vms" className="text-muted-foreground text-sm hover:underline">
            Go to VMs
          </Link>
        }
      >
        {q.isLoading ? <LoadingState rows={6} /> : q.error ? <ErrorState error={q.error} /> : <EventList events={filtered} showObject />}
      </Section>
    </Page>
  );
}
