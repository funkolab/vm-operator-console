import { fieldDocs } from "@console/shared";
import { HelpCircle, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Path into the generated CRD documentation, e.g. "VirtualMachine/spec/compute/memorySize". */
  doc?: string;
  className?: string;
  children: (id: string) => ReactNode;
  locked?: string;
  aside?: ReactNode;
}

export function Field({ label, hint, error, required, doc, className, children, locked, aside }: FieldProps) {
  const id = useId();
  const docText = doc ? fieldDocs[doc] : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="gap-1">
          {label}
          {required && <span className="text-destructive">*</span>}
          {(docText || locked) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="text-muted-foreground size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-pre-line">{locked ?? docText}</TooltipContent>
            </Tooltip>
          )}
        </Label>
        {aside}
      </div>
      {children(id)}
      {error ? <p className="text-destructive text-xs">{error}</p> : hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

const UNITS = ["Mi", "Gi", "Ti"] as const;
const QRE = /^(\d+(?:\.\d+)?)\s*(Mi|Gi|Ti)$/;

/** Number + unit editor for Kubernetes quantities. Falls back to free text for exotic values. */
export function QuantityInput({
  id,
  value,
  onChange,
  disabled,
  defaultUnit = "Gi",
  placeholder,
  invalid,
}: {
  id?: string;
  value?: string | number;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
  defaultUnit?: (typeof UNITS)[number];
  placeholder?: string;
  invalid?: boolean;
}) {
  const str = value === undefined || value === null ? "" : String(value);
  const m = QRE.exec(str);
  const [unit, setUnit] = useState<string>(m?.[2] ?? defaultUnit);
  const [num, setNum] = useState(m?.[1] ?? (str && !m ? str : ""));
  const free = !!str && !m && !/^\d+(\.\d+)?$/.test(num);
  useEffect(() => {
    const mm = QRE.exec(str);
    if (mm) {
      setNum(mm[1] as string);
      setUnit(mm[2] as string);
    } else if (!str) setNum("");
  }, [str]);
  return (
    <div className="flex">
      <Input
        id={id}
        inputMode="decimal"
        value={num}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid}
        className="rounded-r-none"
        onChange={(e) => {
          const v = e.target.value.trim();
          setNum(v);
          if (!v) onChange(undefined);
          else if (/^\d+(\.\d+)?$/.test(v)) onChange(`${v}${unit}`);
          else onChange(v);
        }}
      />
      <Select
        value={unit}
        disabled={disabled || free}
        onValueChange={(u) => {
          setUnit(u);
          if (/^\d+(\.\d+)?$/.test(num)) onChange(`${num}${u}`);
        }}
      >
        <SelectTrigger className="w-20 rounded-l-none border-l-0" aria-label="Unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map((u) => (
            <SelectItem key={u} value={u}>
              {u}B
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  invalid,
  placeholder,
}: {
  id?: string;
  value?: number;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={invalid}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

/** Key/value editor used for labels, matchLabels and cloud-init variables. */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  disabled,
  addLabel = "Add",
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
  addLabel?: string;
}) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value));
  useEffect(() => {
    const current = Object.fromEntries(rows.filter(([k]) => k));
    if (JSON.stringify(current) !== JSON.stringify(value)) setRows(Object.entries(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, rows.filter]);
  const commit = (next: [string, string][]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  };
  return (
    <div className="grid gap-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={k}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            className="font-mono text-sm"
          />
          <Input
            value={v}
            disabled={disabled}
            placeholder={valuePlaceholder}
            onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            className="font-mono text-sm"
          />
          <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label="Remove" onClick={() => commit(rows.filter((_, j) => j !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setRows([...rows, ["", ""]])}>
          <Plus /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function TagInput({ value, onChange, placeholder = "Add tag…" }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().replace(/,/g, "");
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="border-input focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 focus-within:ring-[3px]">
      {value.map((t) => (
        <span key={t} className="bg-secondary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
      />
    </div>
  );
}
