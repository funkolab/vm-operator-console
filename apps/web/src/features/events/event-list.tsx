import { eventTimestamp, type KubeEvent } from "@console/shared";
import { EmptyState } from "@/components/page";
import { formatDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function EventList({ events, showObject }: { events: KubeEvent[]; showObject?: boolean }) {
  const sorted = [...events].sort((a, b) => (eventTimestamp(b) ?? "").localeCompare(eventTimestamp(a) ?? ""));
  if (!sorted.length) return <EmptyState title="No events" description="Kubernetes keeps events for about one hour." className="py-8" />;
  return (
    <ol className="relative ml-2 border-l">
      {sorted.map((e) => (
        <li key={e.metadata.uid ?? `${e.metadata.name}`} className="mb-4 ml-5">
          <span
            className={cn("ring-background absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-4", e.type === "Warning" ? "bg-warning" : "bg-primary/60")}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("text-sm font-medium", e.type === "Warning" && "text-warning")}>{e.reason}</span>
            {showObject && e.involvedObject.name && (
              <span className="text-muted-foreground text-xs">
                {e.involvedObject.kind} {e.involvedObject.namespace}/{e.involvedObject.name}
              </span>
            )}
            <span className="text-muted-foreground text-xs" title={formatDate(eventTimestamp(e))}>
              {relativeTime(eventTimestamp(e))}
              {(e.count ?? e.series?.count ?? 1) > 1 && ` · ×${e.count ?? e.series?.count}`}
            </span>
          </div>
          {e.message && <p className="text-muted-foreground mt-0.5 text-sm break-words">{e.message}</p>}
        </li>
      ))}
    </ol>
  );
}
