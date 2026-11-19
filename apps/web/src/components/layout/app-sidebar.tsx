import { summarizeVM } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, FileCode2, LayoutDashboard, LayoutTemplate, Map as MapIcon, Network, Server, ServerCog } from "lucide-react";
import { BrandMark } from "@/components/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import type { LiveStatus } from "@/lib/live";
import { useNamespace } from "@/lib/namespace";
import { contextsQuery, templatesQuery, vmsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: typeof Server; exact?: boolean; count?: "vms" | "templates" | "contexts" };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/infrastructure", label: "Infrastructure", icon: MapIcon },
      { to: "/events", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Compute",
    items: [
      { to: "/vms", label: "Virtual machines", icon: Server, count: "vms" },
      { to: "/templates", label: "Templates", icon: LayoutTemplate, count: "templates" },
      { to: "/guest-scripts", label: "Guest scripts", icon: FileCode2 },
    ],
  },
  {
    label: "Networking",
    items: [{ to: "/services", label: "VM services", icon: Network }],
  },
  {
    label: "Platform",
    items: [{ to: "/contexts", label: "Prism Central", icon: ServerCog, count: "contexts" }],
  },
];

function FleetPulse() {
  const ns = useNamespace();
  const { data } = useQuery({ ...vmsQuery(ns), staleTime: 15_000 });
  const sums = (data ?? []).map(summarizeVM);
  const total = sums.length;
  if (!total) return null;
  const running = sums.filter((s) => s.phase === "Running").length;
  const issues = sums.filter((s) => s.phase === "Error" || s.phase === "Degraded").length;
  const busy = sums.filter((s) => ["Provisioning", "Starting", "Stopping", "Restarting", "Updating", "Deleting"].includes(s.phase)).length;
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="bg-sidebar-accent/60 mx-2 rounded-lg px-3 py-2.5 group-data-[collapsible=icon]:hidden">
      <div className="text-sidebar-foreground/70 flex items-center justify-between text-[11px] font-medium tracking-wide uppercase">
        <span>Fleet</span>
        <span className="tabular text-sidebar-accent-foreground">{total} VMs</span>
      </div>
      <div className="bg-sidebar-border mt-2 flex h-1.5 overflow-hidden rounded-full">
        <div className="bg-success" style={{ width: seg(running) }} />
        <div className="bg-info" style={{ width: seg(busy) }} />
        <div className="bg-destructive" style={{ width: seg(issues) }} />
      </div>
      <div className="text-sidebar-foreground/70 mt-1.5 flex gap-3 text-[11px]">
        <span>
          <span className="text-success">●</span> {running} running
        </span>
        {issues > 0 && (
          <span>
            <span className="text-destructive">●</span> {issues} issue{issues > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export function AppSidebar({ live }: { live: LiveStatus }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile, isMobile } = useSidebar();
  const ns = useNamespace();
  const counts = {
    vms: useQuery({ ...vmsQuery(ns), staleTime: 15_000 }).data?.length,
    templates: useQuery({ ...templatesQuery(ns), staleTime: 30_000 }).data?.length,
    contexts: useQuery({ ...contextsQuery(ns), staleTime: 30_000 }).data?.length,
  };
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="pt-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-sidebar-accent/60">
              <Link to="/">
                <span className="flex size-8 shrink-0 items-center justify-center">
                  <BrandMark className="!size-8 drop-shadow" />
                </span>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="text-sidebar-accent-foreground truncate text-[15px] font-semibold tracking-tight">VM Console</span>
                  <span className="text-sidebar-foreground/60 truncate text-[11px]">Nutanix vm-operator</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {NAV.map((g) => (
          <SidebarGroup key={g.label} className="py-1.5">
            <SidebarGroupLabel className="text-sidebar-foreground/45 text-[10.5px] font-semibold tracking-[0.08em] uppercase">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname.startsWith(item.to);
                  const count = item.count ? counts[item.count] : undefined;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className={cn(
                          "relative h-9 transition-colors",
                          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium",
                          "data-[active=true]:before:bg-sidebar-primary before:absolute before:top-1.5 before:bottom-1.5 before:-left-2 before:w-[3px] before:rounded-r-full",
                        )}
                      >
                        <Link to={item.to} onClick={() => isMobile && setOpenMobile(false)}>
                          <item.icon className={cn(active && "text-sidebar-primary")} />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {count !== undefined && (
                        <SidebarMenuBadge className="tabular text-sidebar-foreground/60 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground text-[11px]">
                          {count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-2 pb-3">
        <FleetPulse />
        <div className="text-sidebar-foreground/60 flex items-center gap-2 px-3 text-[11px] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              live === "live" ? "bg-success text-success animate-pulse-ring" : live === "connecting" ? "bg-warning animate-pulse" : "bg-destructive",
            )}
          />
          <span className="group-data-[collapsible=icon]:hidden">
            {live === "live" ? "Live — streaming changes" : live === "connecting" ? "Connecting…" : "Live updates offline"}
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
