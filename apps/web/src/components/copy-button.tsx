import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label ?? `Copy ${value}`}
      className={cn("text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center rounded transition-colors", className)}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
    >
      {done ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function Copyable({ value, mono = true, className }: { value?: string; mono?: boolean; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      <span className={cn("truncate", mono && "font-mono text-[0.8125rem]")}>{value}</span>
      <CopyButton value={value} />
    </span>
  );
}
