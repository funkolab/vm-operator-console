import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { Lock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { Topbar } from "@/components/layout/topbar";
import { EmptyState, ErrorState, Spinner } from "@/components/page";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api";
import { useLiveUpdates } from "@/lib/live";
import { ALL, setNamespace, useNamespace } from "@/lib/namespace";
import { meQuery } from "@/lib/queries";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="p-6">
      <EmptyState
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  ),
});

function RootLayout() {
  const me = useQuery(meQuery);
  const ns = useNamespace();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unauth, setUnauth] = useState(false);
  const accessible = me.data?.namespaces.map((n) => n.name) ?? [];
  const liveNamespaces = ns === ALL ? accessible : accessible.filter((n) => n === ns);
  const live = useLiveUpdates(liveNamespaces);

  useEffect(() => {
    const h = () => setUnauth(true);
    window.addEventListener("console:unauthenticated", h);
    return () => window.removeEventListener("console:unauthenticated", h);
  }, []);

  // Fall back to "all namespaces" when the stored namespace is no longer accessible.
  useEffect(() => {
    if (me.data && ns !== ALL && !accessible.includes(ns)) setNamespace(ALL);
  }, [me.data, ns, accessible]);

  if (unauth || (me.error instanceof ApiError && me.error.status === 401))
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Lock className="size-6" />}
          title="Your session has expired"
          description="Sign in again through the cluster authentication portal."
          action={<Button onClick={() => window.location.reload()}>Sign in</Button>}
        />
      </div>
    );
  if (me.isLoading)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Spinner /> Loading your permissions…
      </div>
    );
  if (me.error)
    return (
      <div className="p-6">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );

  return (
    <SidebarProvider>
      <AppSidebar live={live} />
      <SidebarInset className="min-w-0">
        <Topbar onSearch={() => setPaletteOpen(true)} />
        <main className="min-w-0 flex-1">
          {accessible.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<ShieldAlert className="size-6" />}
                title="No accessible namespaces"
                description={`${me.data?.user} has no permission to list VirtualMachines or templates in any namespace. Ask a cluster administrator to bind you to a vm-console role.`}
              />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
