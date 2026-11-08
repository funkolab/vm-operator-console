import { checkParameterValue, REF_PARAMETER_TYPES, type TemplateParameter } from "@console/shared";
import { Field, NumberInput, QuantityInput } from "@/components/form";
import { type RefValue, ResourceRefPicker } from "@/components/resource-ref-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const CATALOG: Record<string, "clusters" | "subnets" | "images" | "storage-containers"> = {
  clusterRef: "clusters",
  subnetRef: "subnets",
  imageRef: "images",
  storageContainerRef: "storage-containers",
};

/** Renders the right input for a template parameter type. */
export function ParameterInput({
  param,
  value,
  onChange,
  namespace,
  context,
  showError,
}: {
  param: TemplateParameter;
  value: unknown;
  onChange: (v: unknown) => void;
  namespace?: string;
  context?: string;
  showError?: boolean;
}) {
  const error = showError ? checkParameterValue(param, value) : undefined;
  const range = param.min !== undefined || param.max !== undefined ? `Between ${param.min ?? "—"} and ${param.max ?? "—"}` : undefined;
  return (
    <Field label={param.label || param.name} required={param.required} error={error} hint={param.description ?? range}>
      {(id) => {
        switch (param.type) {
          case "integer":
            return (
              <NumberInput
                id={id}
                invalid={!!error}
                min={param.min !== undefined ? Number(param.min) : undefined}
                max={param.max !== undefined ? Number(param.max) : undefined}
                value={value === undefined || value === "" ? undefined : Number(value)}
                onChange={onChange}
              />
            );
          case "quantity":
            return <QuantityInput id={id} invalid={!!error} value={value as string} onChange={onChange} />;
          case "boolean":
            return (
              <div className="flex h-9 items-center">
                <Switch id={id} checked={value === true || value === "true"} onCheckedChange={onChange} />
              </div>
            );
          case "enum":
            return (
              <Select value={value === undefined ? undefined : String(value)} onValueChange={onChange}>
                <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(param.options ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          default:
            if (REF_PARAMETER_TYPES.includes(param.type))
              return (
                <ResourceRefPicker
                  id={id}
                  kind={CATALOG[param.type] ?? "clusters"}
                  namespace={namespace}
                  context={context}
                  invalid={!!error}
                  value={value as RefValue}
                  onChange={onChange}
                />
              );
            return <Input id={id} aria-invalid={!!error} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
        }
      }}
    </Field>
  );
}
