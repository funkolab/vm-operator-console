import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { ErrorState } from "@/components/page";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError, basePath, errorMessage } from "@/lib/api";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Background refetch failures surface as toasts; initial loads render inline errors.
      if (query.state.data !== undefined) toast.error(errorMessage(err));
    },
  }),
});

const router = createRouter({
  routeTree,
  basepath: basePath || "/",
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultErrorComponent: ({ error, reset }) => <ErrorState error={error} onRetry={reset} />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster richColors closeButton position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
