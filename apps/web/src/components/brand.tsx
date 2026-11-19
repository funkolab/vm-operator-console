import { cn } from "@/lib/utils";

/** Product mark: stacked isometric layers (VM on hypervisor on cluster). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <defs>
        <linearGradient id="bm-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.72 0.17 264)" />
          <stop offset="1" stopColor="oklch(0.58 0.22 290)" />
        </linearGradient>
        <linearGradient id="bm-b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#bm-a)" />
      <path d="M16 6.5 24.5 11 16 15.5 7.5 11Z" fill="url(#bm-b)" />
      <path d="M7.5 15.2 16 19.7l8.5-4.5" fill="none" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 19.6 16 24.1l8.5-4.5" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
