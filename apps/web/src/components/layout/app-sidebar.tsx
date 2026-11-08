import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Boxes, LayoutDashboard, LayoutTemplate, Network, Server, ServerCog } from "lucide-react";
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
import { cn } from "@/lib/utils";

const NAV = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/events", label: "Events", icon: Activity },
    ],
  },
  {
    label: "Compute",
    items: [
      { to: "/vms", label: "Virtual machines", icon: Server },
      { to: "/templates", label: "Templates", icon: LayoutTemplate },
    ],
  },
  {
    label: "Networking",
    items: [{ to: "/services", label: "VM services", icon: Network }],
  },
  {
    label: "Infrastructure",
    items: [{ to: "/contexts", label: "Prism Central", icon: ServerCog }],
  },
] as const;

export function AppSidebar({ live, counts }: { live: LiveStatus; counts?: Partial<Record<string, number>> }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile, isMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Boxes className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">VM Console</span>
                  <span className="text-muted-foreground truncate text-xs">Nutanix vm-operator</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = "exact" in item && item.exact ? pathname === item.to || pathname === `${item.to}/` : pathname.startsWith(item.to);
                  const count = counts?.[item.to];
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link to={item.to} onClick={() => isMobile && setOpenMobile(false)}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {count !== undefined && <SidebarMenuBadge className="tabular">{count}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs group-data-[collapsible=icon]:justify-center">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              live === "live" ? "bg-success" : live === "connecting" ? "bg-warning animate-pulse" : "bg-destructive",
            )}
          />
          <span className="group-data-[collapsible=icon]:hidden">
            {live === "live" ? "Live updates" : live === "connecting" ? "Connecting…" : "Live updates offline"}
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
