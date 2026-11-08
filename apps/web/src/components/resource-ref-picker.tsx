import type { CatalogKind, NutanixResourceRef } from "@console/shared";
import { NUTANIX_NAME_RE, UUID_RE } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { catalogQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type RefValue = { type: "name" | "extId"; name?: string; extId?: string } | undefined;

const KIND_LABEL: Record<CatalogKind, string> = {
  clusters: "cluster",
  subnets: "subnet",
  images: "image",
  "storage-containers": "storage container",
  categories: "category",
  projects: "project",
};

export function refError(v: RefValue, required?: boolean): string | undefined {
  if (!v || (!v.name && !v.extId)) return required ? "Required" : undefined;
  if (v.type === "extId" && !UUID_RE.test(v.extId ?? "")) return "Must be a UUID";
  if (v.type === "name" && !NUTANIX_NAME_RE.test(v.name ?? "")) return "Letters, digits, spaces, '-', '_' and '.' only";
  return undefined;
}

/**
 * Picker for a Nutanix resource reference. When a Prism Central context is
 * known, offers a searchable list from the catalog proxy; free entry (by name
 * or extId) is always possible so the console stays usable without catalog
 * access.
 */
export function ResourceRefPicker({
  kind,
  namespace,
  context,
  value,
  onChange,
  disabled,
  invalid,
  id,
}: {
  kind: CatalogKind;
  namespace?: string;
  context?: string;
  value: RefValue | NutanixResourceRef | undefined;
  onChange: (v: RefValue) => void;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const v = value as RefValue;
  const q = useQuery({ ...catalogQuery(namespace ?? "", context, kind), enabled: open && !!namespace && !!context });
  const items = q.data?.items ?? [];
  const label = v?.type === "extId" ? (items.find((i) => i.extId === v.extId)?.name ?? v.extId) : v?.name;
  const mode = v?.type ?? "name";

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={mode}
        disabled={disabled}
        onValueChange={(m) => {
          if (!m) return;
          onChange(m === "name" ? { type: "name", name: v?.name ?? "" } : { type: "extId", extId: v?.extId ?? "" });
        }}
        className="shrink-0"
      >
        <ToggleGroupItem value="name" className="px-2.5 text-xs" aria-label="Reference by name">
          Name
        </ToggleGroupItem>
        <ToggleGroupItem value="extId" className="px-2.5 text-xs" aria-label="Reference by UUID">
          UUID
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="flex min-w-0 flex-1">
        <Input
          id={id}
          disabled={disabled}
          aria-invalid={invalid}
          className={cn("min-w-0 flex-1", context && namespace && "rounded-r-none", mode === "extId" && "font-mono text-xs")}
          placeholder={mode === "name" ? `${KIND_LABEL[kind]} name` : "00000000-0000-0000-0000-000000000000"}
          value={(mode === "name" ? v?.name : v?.extId) ?? ""}
          onChange={(e) => onChange(mode === "name" ? { type: "name", name: e.target.value } : { type: "extId", extId: e.target.value.trim() })}
        />
        {context && namespace && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="rounded-l-none border-l-0 px-2.5"
                aria-label={`Browse ${KIND_LABEL[kind]}s`}
              >
                <ChevronsUpDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-0" align="end">
              <Command>
                <CommandInput placeholder={`Search ${KIND_LABEL[kind]}s in ${context}…`} />
                <CommandList>
                  {q.isLoading ? (
                    <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
                      <Loader2 className="size-4 animate-spin" /> Loading from Prism Central…
                    </div>
                  ) : q.data && !q.data.available ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm">
                      <CloudOff className="text-muted-foreground size-5" />
                      <p className="text-muted-foreground">Catalog unavailable: {q.data.message}</p>
                      <p className="text-muted-foreground text-xs">You can still type the {KIND_LABEL[kind]} name or UUID.</p>
                      <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                        <RefreshCw /> Retry
                      </Button>
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No {KIND_LABEL[kind]} found.</CommandEmpty>
                      <CommandGroup>
                        {items.map((i) => {
                          const selected = v?.type === "extId" ? v.extId === i.extId : v?.name === i.name;
                          return (
                            <CommandItem
                              key={i.extId}
                              value={`${i.name} ${i.extId}`}
                              onSelect={() => {
                                onChange(mode === "extId" ? { type: "extId", extId: i.extId } : { type: "name", name: i.name });
                                setOpen(false);
                              }}
                            >
                              <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{i.name}</div>
                                <div className="text-muted-foreground truncate text-xs">
                                  {Object.entries(i.info ?? {})
                                    .map(([k, val]) => `${k}: ${val}`)
                                    .join(" · ") || i.extId}
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {label && mode === "extId" && label !== v?.extId && <span className="text-muted-foreground self-center text-xs">{label}</span>}
    </div>
  );
}
