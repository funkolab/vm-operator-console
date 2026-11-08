import { Box, Monitor, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

export function OsIcon({ os, small }: { os: string; small?: boolean }) {
  const Icon = os === "Windows" ? Monitor : os === "Linux" ? Terminal : Box;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        small ? "size-8" : "size-10",
        os === "Windows" ? "bg-info/12 text-info" : os === "Linux" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
      )}
      title={os}
    >
      <Icon className={small ? "size-4" : "size-5"} />
    </div>
  );
}
