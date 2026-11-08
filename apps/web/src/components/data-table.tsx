import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TTable,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Filter, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface FacetDef {
  columnId: string;
  title: string;
  options?: { value: string; label?: string }[];
}

export function selectColumn<T>(): ColumnDef<T> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all"
        checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox aria-label="Select row" checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 32,
  };
}

export function SortHeader({ label, column }: { label: string; column: { getIsSorted(): false | "asc" | "desc"; toggleSorting(desc?: boolean): void } }) {
  const s = column.getIsSorted();
  return (
    <button
      type="button"
      className="hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5"
      onClick={() => column.toggleSorting(s === "asc")}
    >
      {label}
      {s === "asc" ? <ArrowUp className="size-3.5" /> : s === "desc" ? <ArrowDown className="size-3.5" /> : <ChevronsUpDown className="size-3.5 opacity-40" />}
    </button>
  );
}

function FacetFilter<T>({ table, facet }: { table: TTable<T>; facet: FacetDef }) {
  const column = table.getColumn(facet.columnId);
  const values = column?.getFacetedUniqueValues();
  const selected = new Set((column?.getFilterValue() as string[] | undefined) ?? []);
  const options: { value: string; label?: string }[] =
    facet.options ??
    [...(values?.keys() ?? [])]
      .filter((v) => v !== undefined && v !== "")
      .sort()
      .map((v) => ({ value: String(v) }));
  if (!column) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 border-dashed">
          <Filter className="size-3.5" />
          {facet.title}
          {selected.size > 0 && (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {selected.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={facet.title} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.has(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    onSelect={() => {
                      const next = new Set(selected);
                      if (on) next.delete(o.value);
                      else next.add(o.value);
                      column.setFilterValue(next.size ? [...next] : undefined);
                    }}
                  >
                    <Checkbox checked={on} className="pointer-events-none" />
                    <span className="flex-1 truncate">{o.label ?? o.value}</span>
                    <span className="text-muted-foreground font-mono text-xs">{values?.get(o.value) ?? 0}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => column.setFilterValue(undefined)} className="justify-center">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Filter function for faceted (multi-value) column filters. */
export const facetFilterFn = <T,>(row: Row<T>, id: string, value: string[]) => !value?.length || value.includes(String(row.getValue(id)));

function usePersistentState<V>(key: string | undefined, initial: V): [V, (v: V | ((p: V) => V)) => void] {
  const [v, setV] = useState<V>(() => {
    if (!key) return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as V) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    if (key) localStorage.setItem(key, JSON.stringify(v));
  }, [key, v]);
  return [v, setV];
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  facets = [],
  searchPlaceholder = "Search…",
  globalFilterFn,
  initialSorting = [],
  onRowClick,
  renderMobileCard,
  toolbar,
  bulkActions,
  storageKey,
  emptyState,
  pageSize = 25,
  initialSearch = "",
  onSearchChange,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  facets?: FacetDef[];
  searchPlaceholder?: string;
  globalFilterFn?: (row: T, query: string) => boolean;
  initialSorting?: SortingState;
  onRowClick?: (row: T) => void;
  renderMobileCard?: (row: T, selected: boolean, toggle: () => void) => ReactNode;
  toolbar?: ReactNode;
  bulkActions?: (rows: T[], clear: () => void) => ReactNode;
  storageKey?: string;
  emptyState?: ReactNode;
  pageSize?: number;
  initialSearch?: string;
  onSearchChange?: (q: string) => void;
}) {
  const [sorting, setSorting] = usePersistentState<SortingState>(storageKey && `${storageKey}.sort`, initialSorting);
  const [visibility, setVisibility] = usePersistentState<VisibilityState>(storageKey && `${storageKey}.cols`, {});
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [search, setSearch] = useState(initialSearch);
  const [size, setSize] = usePersistentState<number>(storageKey && `${storageKey}.size`, pageSize);

  const filterFn = useMemo(
    () => (row: Row<T>, _id: string, q: string) => {
      if (!q) return true;
      if (globalFilterFn) return globalFilterFn(row.original, q.toLowerCase());
      return JSON.stringify(row.original).toLowerCase().includes(q.toLowerCase());
    },
    [globalFilterFn],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting, columnVisibility: visibility, columnFilters: filters, rowSelection, globalFilter: search },
    initialState: { pagination: { pageSize: size } },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onColumnFiltersChange: setFilters,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setSearch,
    globalFilterFn: filterFn,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    enableRowSelection: !!bulkActions,
  });

  // Drop selections for rows that disappeared (e.g. deleted via live updates).
  useEffect(() => {
    const ids = new Set(data.map(getRowId));
    setRowSelection((sel) => {
      const next = Object.fromEntries(Object.entries(sel).filter(([k]) => ids.has(k)));
      return Object.keys(next).length === Object.keys(sel).length ? sel : next;
    });
  }, [data, getRowId]);

  useEffect(() => {
    table.setPageSize(size);
  }, [size, table]);

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const rows = table.getRowModel().rows;
  const filtered = table.getFilteredRowModel().rows.length;
  const activeFilters = filters.length > 0 || search !== "";
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              onSearchChange?.(e.target.value);
              table.setPageIndex(0);
            }}
            placeholder={searchPlaceholder}
            className="h-9 pl-8"
            aria-label="Search"
          />
        </div>
        {facets.map((f) => (
          <FacetFilter key={f.columnId} table={table} facet={f} />
        ))}
        {activeFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              setFilters([]);
              setSearch("");
              onSearchChange?.("");
            }}
          >
            Reset <X />
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="hidden h-9 md:inline-flex">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {(c.columnDef.meta as { label?: string } | undefined)?.label ?? c.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {bulkActions && selected.length > 0 && (
        <div className="bg-primary/5 border-primary/20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <div className="flex flex-wrap items-center gap-1.5">{bulkActions(selected, () => setRowSelection({}))}</div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRowSelection({})}>
            Clear
          </Button>
        </div>
      )}

      {data.length === 0 && emptyState ? (
        emptyState
      ) : (
        <>
          {renderMobileCard && (
            <div className="flex flex-col gap-2 md:hidden">
              {rows.length === 0 && <p className="text-muted-foreground py-10 text-center text-sm">No results.</p>}
              {rows.map((r) => (
                <div key={r.id}>{renderMobileCard(r.original, r.getIsSelected(), () => r.toggleSelected())}</div>
              ))}
            </div>
          )}
          <div className={cn("bg-card overflow-hidden rounded-xl border", renderMobileCard && "hidden md:block")}>
            <Table>
              <TableHeader className="bg-muted/40">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id} className="hover:bg-transparent">
                    {hg.headers.map((h) => (
                      <TableHead
                        key={h.id}
                        style={h.column.columnDef.size && h.column.id === "select" ? { width: h.column.columnDef.size } : undefined}
                        className="text-muted-foreground h-10 text-xs font-medium tracking-wide uppercase"
                      >
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-muted-foreground h-28 text-center">
                      No results.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={r.id}
                      data-state={r.getIsSelected() ? "selected" : undefined}
                      className={cn(onRowClick && "cursor-pointer")}
                      onClick={(e) => {
                        if (!onRowClick) return;
                        const target = e.target as HTMLElement;
                        if (target.closest("button, a, input, [role=menuitem], [role=checkbox]")) return;
                        onRowClick(r.original);
                      }}
                    >
                      {r.getVisibleCells().map((c) => (
                        <TableCell key={c.id} className="py-2.5">
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{filtered === data.length ? `${data.length} item${data.length === 1 ? "" : "s"}` : `${filtered} of ${data.length} items`}</span>
            {(pageCount > 1 || size !== pageSize) && (
              <div className="flex items-center gap-2">
                <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
                  <SelectTrigger size="sm" className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100, 250].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} / page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="tabular">
                  Page {pageIndex + 1} of {Math.max(pageCount, 1)}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
