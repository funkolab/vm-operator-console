import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw, SearchX } from "lucide-react";
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
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  /** Small label above the title (e.g. resource kind). */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("animate-fade-up flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3.5">
        {icon && (
          <div className="from-primary/15 to-violet/10 text-primary ring-primary/15 mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="text-muted-foreground mb-0.5 text-[11px] font-semibold tracking-[0.08em] uppercase">{eyebrow}</div>}
          <h1 className="text-[1.375rem] leading-tight font-semibold tracking-[-0.015em] sm:text-[1.625rem]">{title}</h1>
          {description && <div className="text-muted-foreground mt-1 text-sm">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-6 p-4 sm:p-6 lg:p-8", className)}>{children}</div>;
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
    <div
      className={cn(
        "bg-grid relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      <div className="bg-card text-muted-foreground ring-border flex size-14 items-center justify-center rounded-2xl shadow-md ring-1">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        {description && <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm text-balance">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function NoResults({ onReset }: { onReset?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <SearchX className="text-muted-foreground size-6" />
      <p className="text-sm font-medium">No matching results</p>
      {onReset && (
        <Button variant="link" size="sm" onClick={onReset}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const forbidden = error instanceof ApiError && error.status === 403;
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className={cn("bg-card flex flex-col items-center justify-center gap-4 rounded-xl border px-6 py-16 text-center", className)}>
      <div
        className={cn(
          "flex size-14 items-center justify-center rounded-2xl ring-1 ring-inset",
          forbidden ? "bg-warning/12 text-warning ring-warning/25" : "bg-destructive/10 text-destructive ring-destructive/20",
        )}
      >
        {forbidden ? <Lock className="size-6" /> : <AlertTriangle className="size-6" />}
      </div>
      <div>
        <p className="text-[15px] font-semibold">{forbidden ? "Access denied" : notFound ? "Not found" : "Something went wrong"}</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm break-words">{errorMessage(error)}</p>
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
        <Skeleton key={i} className="h-11 w-full" style={{ opacity: 1 - i * 0.1 }} />
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
  bodyClassName,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={cn("surface flex flex-col", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
            {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("flex-1 p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2", className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i, idx) => (
          <div key={idx} className="min-w-0">
            <dt className="text-muted-foreground text-[11px] font-semibold tracking-[0.06em] uppercase">{i.label}</dt>
            <dd className="mt-1 text-sm break-words">{i.value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Compact key metric tile used on dashboards and detail pages. */
export function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "primary",
  children,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "primary" | "success" | "warning" | "danger" | "info" | "violet" | "muted";
  children?: ReactNode;
  className?: string;
}) {
  const toneCls = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-destructive/10 text-destructive",
    info: "bg-info/12 text-info",
    violet: "bg-violet/12 text-violet",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <div className={cn("surface flex flex-col gap-3 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-[12px] font-medium">{label}</div>
          <div className="tabular mt-1 truncate text-[1.6rem] leading-none font-semibold tracking-tight">{value}</div>
        </div>
        {icon && <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]", toneCls)}>{icon}</div>}
      </div>
      {children}
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}
