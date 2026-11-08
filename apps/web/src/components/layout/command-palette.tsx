import { summarizeVM } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Activity, FileCode2, LayoutDashboard, LayoutTemplate, Moon, Network, Plus, Server, ServerCog, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useNamespace } from "@/lib/namespace";
import { contextsQuery, templatesQuery, vmsQuery } from "@/lib/queries";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const ns = useNamespace();
  const { setTheme, resolvedTheme } = useTheme();
  const vms = useQuery({ ...vmsQuery(ns), enabled: open });
  const templates = useQuery({ ...templatesQuery(ns), enabled: open });
  const contexts = useQuery({ ...contextsQuery(ns), enabled: open });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search resources and run commands">
      <CommandInput placeholder="Search VMs, templates, pages…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go(() => navigate({ to: "/vms/new" }))}>
            <Plus /> Create virtual machine
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/templates/new" }))}>
            <Plus /> Create template
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/contexts/new" }))}>
            <Plus /> Add Prism Central account
          </CommandItem>
          <CommandItem onSelect={() => go(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
            {resolvedTheme === "dark" ? <Sun /> : <Moon />} Toggle theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => go(() => navigate({ to: "/" }))}>
            <LayoutDashboard /> Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/vms" }))}>
            <Server /> Virtual machines
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/templates" }))}>
            <LayoutTemplate /> Templates
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/guest-scripts" }))}>
            <FileCode2 /> Guest scripts
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/services" }))}>
            <Network /> VM services
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/contexts" }))}>
            <ServerCog /> Prism Central
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/events" }))}>
            <Activity /> Events
          </CommandItem>
        </CommandGroup>
        {!!vms.data?.length && (
          <CommandGroup heading="Virtual machines">
            {vms.data.slice(0, 200).map((vm) => {
              const s = summarizeVM(vm);
              return (
                <CommandItem
                  key={s.key}
                  value={`vm ${s.name} ${s.displayName} ${s.namespace} ${s.primaryIP ?? ""}`}
                  onSelect={() => go(() => navigate({ to: "/vms/$ns/$name", params: { ns: s.namespace, name: s.name } }))}
                >
                  <Server />
                  <span className="truncate">{s.displayName}</span>
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {s.namespace}
                    {s.primaryIP ? ` · ${s.primaryIP}` : ""}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {!!templates.data?.length && (
          <CommandGroup heading="Templates">
            {templates.data.map((t) => (
              <CommandItem
                key={`${t.namespace}/${t.name}`}
                value={`template ${t.name} ${t.displayName} ${t.tags.join(" ")}`}
                onSelect={() => go(() => navigate({ to: "/templates/$ns/$name", params: { ns: t.namespace, name: t.name } }))}
              >
                <LayoutTemplate />
                <span className="truncate">{t.displayName}</span>
                <span className="text-muted-foreground ml-auto text-xs">{t.namespace}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!contexts.data?.length && (
          <CommandGroup heading="Prism Central">
            {contexts.data.map((c) => (
              <CommandItem
                key={`${c.metadata.namespace}/${c.metadata.name}`}
                value={`context ${c.metadata.name} ${c.spec.endpoint.address}`}
                onSelect={() =>
                  go(() => navigate({ to: "/contexts/$ns/$name", params: { ns: c.metadata.namespace as string, name: c.metadata.name as string } }))
                }
              >
                <ServerCog />
                <span className="truncate">{c.metadata.name}</span>
                <span className="text-muted-foreground ml-auto text-xs">{c.spec.endpoint.address}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
