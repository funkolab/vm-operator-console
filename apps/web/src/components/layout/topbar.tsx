import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Layers, LogOut, Monitor, Moon, RefreshCw, Search, Sun, User } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import { ALL, setNamespace, useNamespace } from "@/lib/namespace";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function NamespaceSwitcher() {
  const ns = useNamespace();
  const { data } = useMe();
  const [open, setOpen] = useState(false);
  const namespaces = data?.namespaces ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 max-w-[52vw] justify-between gap-2 sm:w-56" aria-label="Select namespace">
          <Layers className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{ns === ALL ? "All namespaces" : ns}</span>
          <ChevronsUpDown className="ml-auto size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find namespace…" />
          <CommandList>
            <CommandEmpty>No namespace</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  setNamespace(ALL);
                  setOpen(false);
                }}
              >
                <Check className={cn("size-4", ns === ALL ? "opacity-100" : "opacity-0")} />
                All namespaces
                <span className="text-muted-foreground ml-auto text-xs">{namespaces.length}</span>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Namespaces you can access">
              {namespaces.map((n) => {
                const readOnly = !n.permissions.virtualmachines?.create && !n.permissions.virtualmachines?.patch;
                return (
                  <CommandItem
                    key={n.name}
                    value={n.name}
                    onSelect={() => {
                      setNamespace(n.name);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("size-4", ns === n.name ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{n.name}</span>
                    {readOnly && (
                      <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                        read-only
                      </Badge>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { data } = useMe();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-2 px-2" aria-label="User menu">
          <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-full text-xs font-semibold uppercase">
            {data?.user?.slice(0, 2) ?? <User className="size-4" />}
          </span>
          <span className="hidden max-w-40 truncate text-sm lg:inline">{data?.user}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{data?.user}</div>
          {!!data?.groups.length && <div className="text-muted-foreground mt-0.5 line-clamp-3 text-xs">Groups: {data.groups.join(", ")}</div>}
          <div className="text-muted-foreground mt-1 text-xs">Kubernetes RBAC applied via impersonation · {data?.namespaces.length ?? 0} namespace(s)</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await api.me.refresh.$post();
            await qc.invalidateQueries();
          }}
        >
          <RefreshCw /> Refresh permissions
        </DropdownMenuItem>
        {data?.authMode === "traefik" && (
          <DropdownMenuItem asChild>
            <a href="/logout">
              <LogOut /> Sign out
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 !h-5" />
      <NamespaceSwitcher />
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="text-muted-foreground h-9 gap-2 sm:w-56 sm:justify-start" onClick={onSearch} aria-label="Search">
          <Search className="size-4" />
          <span className="hidden sm:inline">Search…</span>
          <kbd className="bg-muted ml-auto hidden rounded border px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
