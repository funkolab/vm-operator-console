import { summarizeVM, type VMSummary } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Copy,
  FileCode2,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  LineChart,
  Map as MapIcon,
  MonitorPlay,
  Moon,
  Network,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Server,
  ServerCog,
  Sparkles,
  Square,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { PhaseBadge } from "@/components/status";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { usePowerAction } from "@/features/vms/actions";
import { useNamespace, useWorkspaceLabel } from "@/lib/namespace";
import { contextsQuery, templatesQuery, useCan, vmsQuery } from "@/lib/queries";

export const SHORTCUTS: { keys: string; label: string; to?: string }[] = [
  { keys: "⌘ K", label: "Open the command palette" },
  { keys: "G D", label: "Go to dashboard", to: "/" },
  { keys: "G V", label: "Go to virtual machines", to: "/vms" },
  { keys: "G T", label: "Go to templates", to: "/templates" },
  { keys: "G I", label: "Go to infrastructure", to: "/infrastructure" },
  { keys: "G N", label: "Go to insights", to: "/insights" },
  { keys: "G A", label: "Go to activity", to: "/events" },
  { keys: "G P", label: "Go to Prism Central", to: "/contexts" },
  { keys: "C", label: "Create a VM", to: "/vms/new" },
  { keys: "?", label: "Show keyboard shortcuts" },
];

const GO: Record<string, string> = { d: "/", v: "/vms", t: "/templates", i: "/infrastructure", n: "/insights", a: "/events", p: "/contexts", s: "/services" };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || !!t.closest(".cm-editor,[role=dialog] canvas"));
};

/** Global "g x" navigation shortcuts, "c" to create and "?" for help. */
export function useGlobalShortcuts(onHelp: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (pending) {
        pending = false;
        clearTimeout(timer);
        const to = GO[k];
        if (to) {
          e.preventDefault();
          void navigate({ to });
        }
        return;
      }
      if (k === "g") {
        pending = true;
        timer = setTimeout(() => (pending = false), 1200);
      } else if (k === "c") {
        e.preventDefault();
        void navigate({ to: "/vms/new" });
      } else if (e.key === "?") {
        e.preventDefault();
        onHelp();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate, onHelp]);
}

export function CommandPalette({ open, onOpenChange, onHelp }: { open: boolean; onOpenChange: (o: boolean) => void; onHelp: () => void }) {
  const navigate = useNavigate();
  const ns = useNamespace();
  const wsLabel = useWorkspaceLabel();
  const can = useCan();
  const power = usePowerAction();
  const { setTheme, resolvedTheme } = useTheme();
  const vms = useQuery({ ...vmsQuery(ns), enabled: open });
  const templates = useQuery({ ...templatesQuery(ns), enabled: open });
  const contexts = useQuery({ ...contextsQuery(ns), enabled: open });
  const [vm, setVm] = useState<VMSummary | null>(null);
  const [search, setSearch] = useState("");

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

  useEffect(() => {
    if (!open) {
      setVm(null);
      setSearch("");
    }
  }, [open]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const toVM = (s: VMSummary, tab?: "monitoring" | "console") =>
    go(() => navigate({ to: "/vms/$ns/$name", params: { ns: s.namespace, name: s.name }, search: tab ? { tab } : {} }));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search resources and run commands" className="sm:max-w-xl">
      <CommandInput
        placeholder={vm ? `Actions for ${vm.displayName}…` : "Search VMs, templates, pages or type a command…"}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(e) => {
          if (vm && e.key === "Backspace" && !search) {
            e.preventDefault();
            setVm(null);
          }
        }}
      />
      <CommandList className="max-h-[min(60vh,480px)]">
        <CommandEmpty>No results found.</CommandEmpty>
        {vm ? (
          <>
            <CommandGroup heading={`${vm.displayName} · ${wsLabel(vm.namespace)}`}>
              <CommandItem
                onSelect={() => {
                  setVm(null);
                  setSearch("");
                }}
              >
                <ArrowLeft /> Back
              </CommandItem>
              <CommandItem onSelect={() => toVM(vm)}>
                <Server /> Open details
              </CommandItem>
              <CommandItem onSelect={() => toVM(vm, "monitoring")}>
                <LineChart /> Monitoring
              </CommandItem>
              {vm.powerState === "On" && (
                <CommandItem onSelect={() => toVM(vm, "console")}>
                  <MonitorPlay /> Open console
                </CommandItem>
              )}
            </CommandGroup>
            {can(vm.namespace, "virtualmachines", "patch") && (
              <CommandGroup heading="Power">
                {vm.desiredPowerState === "Off" ? (
                  <CommandItem onSelect={() => go(() => power.mutate({ ns: vm.namespace, name: vm.name, action: "start" }))}>
                    <Play /> Power on
                  </CommandItem>
                ) : (
                  <CommandItem onSelect={() => go(() => power.mutate({ ns: vm.namespace, name: vm.name, action: "stop" }))}>
                    <Square /> Power off
                  </CommandItem>
                )}
                {vm.externalID && (
                  <CommandItem onSelect={() => go(() => power.mutate({ ns: vm.namespace, name: vm.name, action: "restart" }))}>
                    <RotateCcw /> Restart
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            <CommandGroup heading="Manage">
              {can(vm.namespace, "virtualmachines", "update") && (
                <CommandItem onSelect={() => go(() => navigate({ to: "/vms/$ns/$name/edit", params: { ns: vm.namespace, name: vm.name } }))}>
                  <Pencil /> Edit configuration
                </CommandItem>
              )}
              {can(vm.namespace, "virtualmachines", "create") && (
                <CommandItem onSelect={() => go(() => navigate({ to: "/vms/new", search: { from: `${vm.namespace}/${vm.name}` } }))}>
                  <Copy /> Clone
                </CommandItem>
              )}
              <CommandItem onSelect={() => toVM(vm)}>
                <CalendarClock /> Power schedule
              </CommandItem>
            </CommandGroup>
          </>
        ) : (
          <>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={() => go(() => navigate({ to: "/vms/new" }))}>
                <Plus /> Create virtual machine
                <CommandShortcut>C</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => go(() => navigate({ to: "/templates" }))}>
                <LayoutTemplate /> Deploy from a template
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
              <CommandItem onSelect={() => go(onHelp)}>
                <Keyboard /> Keyboard shortcuts
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            {!!vms.data?.length && (
              <CommandGroup heading="Virtual machines — Enter for actions">
                {vms.data.slice(0, 200).map((v) => {
                  const s = summarizeVM(v);
                  return (
                    <CommandItem
                      key={s.key}
                      value={`vm ${s.name} ${s.displayName} ${wsLabel(s.namespace)} ${s.primaryIP ?? ""}`}
                      onSelect={() => {
                        setVm(s);
                        setSearch("");
                      }}
                    >
                      <Server />
                      <span className="truncate">{s.displayName}</span>
                      <span className="text-muted-foreground truncate text-xs">{wsLabel(s.namespace)}</span>
                      <span className="ml-auto">
                        <PhaseBadge phase={s.phase} className="h-5 px-2 text-[10px]" />
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandSeparator />
            <CommandGroup heading="Pages">
              {[
                { to: "/", label: "Dashboard", icon: LayoutDashboard, k: "G D" },
                { to: "/vms", label: "Virtual machines", icon: Server, k: "G V" },
                { to: "/infrastructure", label: "Infrastructure", icon: MapIcon, k: "G I" },
                { to: "/insights", label: "Insights", icon: Sparkles, k: "G N" },
                { to: "/templates", label: "Templates", icon: LayoutTemplate, k: "G T" },
                { to: "/guest-scripts", label: "Guest scripts", icon: FileCode2 },
                { to: "/services", label: "VM services", icon: Network, k: "G S" },
                { to: "/contexts", label: "Prism Central", icon: ServerCog, k: "G P" },
                { to: "/events", label: "Activity", icon: Activity, k: "G A" },
              ].map((p) => (
                <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(() => navigate({ to: p.to }))}>
                  <p.icon /> {p.label}
                  {p.k && <CommandShortcut>{p.k}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
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
                    <span className="text-muted-foreground ml-auto text-xs">{wsLabel(t.namespace)}</span>
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
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
