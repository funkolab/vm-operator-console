import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsUpDown,
  Info,
  Layers,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun,
  User,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { markAlertsSeen, useAlerts } from "@/lib/alerts";
import { api, basePath } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { ALL, setWorkspace, useWorkspace, useWorkspaceLabel, useWorkspaceName, useWorkspaces } from "@/lib/namespace";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function WorkspaceSwitcher() {
  const selected = useWorkspaceName();
  const current = useWorkspace();
  const workspaces = useWorkspaces();
  const [open, setOpen] = useState(false);
  const label = selected === ALL || !current ? "All workspaces" : current.displayName;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 max-w-[52vw] justify-between gap-2 sm:w-56" aria-label="Select workspace">
          <Layers className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-auto size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find workspace…" />
          <CommandList>
            <CommandEmpty>No workspace</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__ all workspaces"
                onSelect={() => {
                  setWorkspace(ALL);
                  setOpen(false);
                }}
              >
                <Check className={cn("size-4", selected === ALL ? "opacity-100" : "opacity-0")} />
                All workspaces
                <span className="text-muted-foreground ml-auto text-xs">{workspaces.length}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Workspaces you can access">
              {workspaces.map((w) => {
                const readOnly = !w.permissions.virtualmachines?.create && !w.permissions.virtualmachines?.patch;
                return (
                  <CommandItem
                    key={w.name}
                    value={`${w.displayName} ${w.name}`}
                    onSelect={() => {
                      setWorkspace(w.name);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("size-4", selected === w.name ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{w.displayName}</span>
                    {readOnly && (
                      <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                        read-only
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { data } = useMe();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2 px-2" aria-label="User menu">
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-xs font-semibold uppercase">
            {data?.user?.slice(0, 2) ?? <User className="size-4" />}
          </span>
          <span className="hidden max-w-40 truncate text-sm lg:inline">{data?.user}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{data?.user}</div>
          {!!data?.groups.length && <div className="text-muted-foreground mt-0.5 line-clamp-3 text-xs">Groups: {data.groups.join(", ")}</div>}
          <div className="text-muted-foreground mt-1 text-xs">Kubernetes RBAC applied via impersonation · {data?.namespaces.length ?? 0} namespace(s)</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await api.me.refresh.$post();
            await qc.invalidateQueries();
          }}
        >
          <RefreshCw /> Refresh permissions
        </DropdownMenuItem>
        {data?.authMode === "traefik" && (
          <DropdownMenuItem asChild>
            <a href="/logout">
              <LogOut /> Sign out
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SEGMENT_LABEL: Record<string, string> = {
  vms: "Virtual machines",
  templates: "Templates",
  "guest-scripts": "Guest scripts",
  services: "VM services",
  contexts: "Prism Central",
  events: "Activity",
  infrastructure: "Infrastructure",
  insights: "Insights",
  new: "New",
  edit: "Edit",
};

/** Breadcrumbs derived from the URL: /vms/team-a/web-01/edit → Virtual machines › team-a › web-01 › Edit. */
function Crumbs() {
  const wsLabel = useWorkspaceLabel();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rel = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return <span className="hidden text-sm font-medium md:inline">Dashboard</span>;
  const items: { label: string; to?: string; mono?: boolean }[] = [];
  const section = parts[0] as string;
  items.push({ label: SEGMENT_LABEL[section] ?? section, to: parts.length > 1 ? `/${section}` : undefined });
  if (parts.length >= 3 && parts[1] !== "new") {
    items.push({ label: wsLabel(parts[1]) });
    items.push({ label: parts[2] as string, to: parts.length > 3 ? `/${section}/${parts[1]}/${parts[2]}` : undefined, mono: true });
    if (parts[3]) items.push({ label: SEGMENT_LABEL[parts[3]] ?? parts[3] });
  } else if (parts[1]) items.push({ label: SEGMENT_LABEL[parts[1]] ?? parts[1] });
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
      {items.map((it, i) => (
        <span key={`${it.label}-${i}`} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="text-muted-foreground/50 size-3.5 shrink-0" />}
          {it.to ? (
            <Link to={it.to} className={cn("text-muted-foreground hover:text-foreground truncate transition-colors", it.mono && "font-mono text-[12.5px]")}>
              {it.label}
            </Link>
          ) : (
            <span className={cn("truncate font-medium", it.mono && "font-mono text-[12.5px]", i < items.length - 1 && "text-muted-foreground")}>
              {it.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

const SEVERITY_STYLE = {
  critical: "bg-destructive/12 text-destructive",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/12 text-info",
} as const;

function AlertsBell() {
  const wsLabel = useWorkspaceLabel();
  const { alerts, unseen } = useAlerts();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o && unseen.length) markAlertsSeen(unseen.map((a) => a.id));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-9" aria-label={`Alerts (${unseen.length} new)`}>
          <Bell className="size-[18px]" />
          {unseen.length > 0 && (
            <span className="bg-destructive text-destructive-foreground ring-background absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ring-2">
              {unseen.length > 9 ? "9+" : unseen.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Alerts</div>
            <div className="text-muted-foreground text-xs">
              {alerts.length ? `${alerts.length} active \u00b7 derived from live state` : "Derived from live state"}
            </div>
          </div>
          {unseen.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markAlertsSeen(unseen.map((a) => a.id))}>
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-auto">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <div className="bg-success/12 text-success flex size-10 items-center justify-center rounded-full">
                <CheckCheck className="size-5" />
              </div>
              <div className="text-sm font-medium">All clear</div>
              <div className="text-muted-foreground text-xs">No failing VM, drift or disconnected Prism Central.</div>
            </div>
          ) : (
            <ul className="divide-y">
              {alerts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="hover:bg-accent/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors"
                    onClick={() => {
                      setOpen(false);
                      markAlertsSeen([a.id]);
                      void navigate(
                        a.kind === "vm"
                          ? { to: "/vms/$ns/$name", params: { ns: a.namespace, name: a.name } }
                          : { to: "/contexts/$ns/$name", params: { ns: a.namespace, name: a.name } },
                      );
                    }}
                  >
                    <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md", SEVERITY_STYLE[a.severity])}>
                      {a.severity === "info" ? <Info className="size-4" /> : <AlertTriangle className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{a.title}</span>
                        {!unseen.some((u) => u.id === a.id) ? null : <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                      </span>
                      {a.detail && <span className="text-muted-foreground line-clamp-2 text-xs">{a.detail}</span>}
                      <span className="text-muted-foreground/80 mt-0.5 block text-[11px]">
                        {wsLabel(a.namespace)}
                        {a.since ? ` \u00b7 ${relativeTime(a.since)}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden size-9 sm:inline-flex"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-[18px] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
      <Moon className="absolute size-[18px] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
    </Button>
  );
}

export function Topbar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="bg-background/75 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-1.5 border-b px-2.5 sm:gap-2 backdrop-blur-xl sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-5" />
      <WorkspaceSwitcher />
      <Separator orientation="vertical" className="mx-1 hidden !h-5 md:block" />
      <Crumbs />
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Button
          variant="outline"
          size="sm"
          className="text-muted-foreground bg-background/60 mr-1 h-9 gap-2 shadow-none sm:w-60 sm:justify-start"
          onClick={onSearch}
          aria-label="Search"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Search or run a command…</span>
          <kbd className="bg-muted text-muted-foreground ml-auto hidden rounded border px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
        </Button>
        <ThemeToggle />
        <AlertsBell />
        <UserMenu />
      </div>
    </header>
  );
}
