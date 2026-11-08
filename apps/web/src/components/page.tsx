import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="bg-primary/10 text-primary mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description && <div className="text-muted-foreground mt-1 text-sm">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6", className)}>{children}</div>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center", className)}>
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">{icon ?? <Inbox className="size-6" />}</div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground mt-1 max-w-md text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-14 text-center", className)}>
      <div
        className={cn("flex size-12 items-center justify-center rounded-full", forbidden ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive")}
      >
        {forbidden ? <Lock className="size-6" /> : <AlertTriangle className="size-6" />}
      </div>
      <div>
        <p className="font-medium">{forbidden ? "Access denied" : notFound ? "Not found" : "Something went wrong"}</p>
        <p className="text-muted-foreground mt-1 max-w-xl text-sm break-words">{errorMessage(error)}</p>
      </div>
      {onRetry && !forbidden && !notFound && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("bg-card rounded-xl border", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div>
          <h2 className="font-medium">{title}</h2>
          {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i, idx) => (
          <div key={idx} className="min-w-0">
            <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{i.label}</dt>
            <dd className="mt-1 text-sm break-words">{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}
