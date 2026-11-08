import type { CatalogItem, CatalogKind, NutanixResourceRef } from "@console/shared";
import { NUTANIX_NAME_RE, UUID_RE } from "@console/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, CloudOff, Loader2, Pencil, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  if (v.type === "extId" && !UUID_RE.test(v.extId ?? "")) return "Invalid reference";
  if (v.type === "name" && !NUTANIX_NAME_RE.test(v.name ?? "")) return "Letters, digits, spaces, '-', '_' and '.' only";
  return undefined;
}

const describe = (i: CatalogItem) =>
  Object.entries(i.info ?? {})
    .map(([k, val]) => `${k}: ${val}`)
    .join(" · ");

/**
 * Picker for a Nutanix resource reference, by name. With a Prism Central
 * context the whole field opens a searchable list from the catalog proxy;
 * a name can still be typed so the console stays usable without catalog
 * access. A name shared by several resources (e.g. the same subnet on two
 * clusters) is stored by extId, since the operator rejects ambiguous names.
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
  const [search, setSearch] = useState("");
  const v = value as RefValue;
  const label = KIND_LABEL[kind];
  const browsable = !!context && !!namespace;
  // References stored by extId (picked duplicates, YAML) need the catalog to show their name.
  const q = useQuery({ ...catalogQuery(namespace ?? "", context, kind), enabled: browsable && (open || v?.type === "extId") });
  const items = q.data?.items ?? [];
  const picked = v?.type === "extId" ? items.find((i) => i.extId === v.extId) : undefined;
  const display = v?.type === "extId" ? (picked?.name ?? (q.isLoading ? "…" : "Unknown resource")) : v?.name;

  if (!browsable)
    return (
      <Input
        id={id}
        disabled={disabled}
        aria-invalid={invalid}
        placeholder={`${label} name`}
        value={(v?.type === "extId" ? v.extId : v?.name) ?? ""}
        onChange={(e) => onChange({ type: "name", name: e.target.value })}
      />
    );

  const choose = (i: CatalogItem) => {
    const shared = items.filter((x) => x.name === i.name).length > 1;
    onChange(shared ? { type: "extId", extId: i.extId } : { type: "name", name: i.name });
    setOpen(false);
  };
  const typed = search.trim();
  const canUseTyped = !!typed && !items.some((i) => i.name === typed);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="w-full justify-between px-3 font-normal"
        >
          <span className={cn("min-w-0 truncate text-left", !display && "text-muted-foreground")}>
            {display || `Select ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}…`}
            {picked && describe(picked) && <span className="text-muted-foreground ml-2 text-xs">{describe(picked)}</span>}
          </span>
          <ChevronsUpDown className="text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput value={search} onValueChange={setSearch} placeholder={`Search ${label}s in ${context}…`} />
          <CommandList>
            {q.isLoading ? (
              // Same height as the loaded list, so the popup does not flip above the field once loaded.
              <div className="text-muted-foreground flex h-[300px] items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading from Prism Central…
              </div>
            ) : q.data && !q.data.available ? (
              <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm">
                <CloudOff className="text-muted-foreground size-5" />
                <p className="text-muted-foreground">Catalog unavailable: {q.data.message}</p>
                <p className="text-muted-foreground text-xs">Type the {label} name in the search field to use it.</p>
                <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                  <RefreshCw /> Retry
                </Button>
              </div>
            ) : (
              <>
                {!canUseTyped && <CommandEmpty>No {label} found.</CommandEmpty>}
                <CommandGroup>
                  {items.map((i) => {
                    const selected = v?.type === "extId" ? v.extId === i.extId : v?.name === i.name;
                    const info = describe(i);
                    return (
                      <CommandItem key={i.extId} value={`${i.name} ${info} ${i.extId}`} onSelect={() => choose(i)}>
                        <Check className={cn("size-4", selected ? "opacity-100" : "opacity-0")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{i.name}</div>
                          {info && <div className="text-muted-foreground truncate text-xs">{info}</div>}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
            {(canUseTyped || display) && !q.isLoading && (
              <>
                <CommandSeparator />
                <CommandGroup forceMount>
                  {canUseTyped && (
                    <CommandItem
                      forceMount
                      value={`__use__ ${typed}`}
                      onSelect={() => {
                        onChange({ type: "name", name: typed });
                        setOpen(false);
                      }}
                    >
                      <Pencil className="size-4" /> Use “{typed}”
                    </CommandItem>
                  )}
                  {display && (
                    <CommandItem
                      forceMount
                      value="__clear__"
                      onSelect={() => {
                        onChange(undefined);
                        setOpen(false);
                      }}
                    >
                      <X className="size-4" /> Clear selection
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
