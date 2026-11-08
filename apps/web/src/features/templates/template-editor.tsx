import {
  DNS1123_LABEL,
  PARAMETER_TYPES,
  type ParameterType,
  SUGGESTED_PARAMETERS,
  suggestParameterName,
  type TemplateParameter,
  TemplateParametersSchema,
  type ValidationIssue,
  type VMTemplate,
  validateTemplateVM,
  zodIssues,
} from "@console/shared";
import { AlertTriangle, Code2, FileText, ListChecks, Plus, Sparkles, Trash2, Variable } from "lucide-react";
import { useMemo, useState } from "react";
import { parse, stringify } from "yaml";
import { Field, TagInput } from "@/components/form";
import { YamlEditor } from "@/components/lazy";
import { Spinner } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionCard, VMSpecEditor } from "@/features/vms/spec-editor";
import { errorIssues } from "@/lib/api";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ParameterType, string> = {
  string: "Text",
  integer: "Integer",
  quantity: "Size (quantity)",
  boolean: "Yes / No",
  enum: "Choice list",
  clusterRef: "Cluster",
  subnetRef: "Subnet",
  imageRef: "Image",
  storageContainerRef: "Storage container",
};

export type TemplateDraft = Omit<VMTemplate, "resourceVersion" | "createdAt" | "createdBy" | "updatedBy" | "usageCount">;

function ParamToggle({
  path,
  label,
  params,
  onChange,
}: {
  path: string;
  label: string;
  params: TemplateParameter[];
  onChange: (p: TemplateParameter[]) => void;
}) {
  const active = params.some((p) => p.path === path);
  const suggestion = SUGGESTED_PARAMETERS.find((s) => s.path === path);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (active) onChange(params.filter((p) => p.path !== path));
            else {
              let name = suggestParameterName(path);
              while (params.some((p) => p.name === name)) name = `${name}_2`;
              onChange([
                ...params,
                {
                  name,
                  label,
                  path,
                  type: suggestion?.type ?? "string",
                  ...(suggestion?.required ? { required: true } : {}),
                  ...(suggestion?.options ? { options: suggestion.options } : {}),
                },
              ]);
            }
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            active ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
        >
          <Variable className="size-3" />
          {active ? "Parameter" : "Ask"}
        </button>
      </TooltipTrigger>
      <TooltipContent>{active ? "Asked at deploy time; click to use the fixed value" : "Ask for this value when deploying"}</TooltipContent>
    </Tooltip>
  );
}

function ParametersBuilder({
  params,
  onChange,
  issues,
}: {
  params: TemplateParameter[];
  onChange: (p: TemplateParameter[]) => void;
  issues: ValidationIssue[];
}) {
  const update = (i: number, patch: Partial<TemplateParameter>) => onChange(params.map((p, j) => (j === i ? ({ ...p, ...patch } as TemplateParameter) : p)));
  const err = (i: number, f: string) => issues.find((x) => x.path === `/parameters/${i}/${f}`)?.message;
  return (
    <SectionCard
      id="parameters"
      icon={<ListChecks className="size-4" />}
      title="Deploy-time parameters"
      description="Values requested when a VM is deployed from this template. Use the “Ask” chips in the form or add them here."
      aside={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <Plus /> Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Common fields</DropdownMenuLabel>
            {SUGGESTED_PARAMETERS.filter((s) => !params.some((p) => p.path === s.path)).map((s) => (
              <DropdownMenuItem
                key={s.path}
                onSelect={() => {
                  let name = suggestParameterName(s.path);
                  while (params.some((p) => p.name === name)) name = `${name}_2`;
                  onChange([...params, { ...s, name }]);
                }}
              >
                <Sparkles /> {s.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([...params, { name: `param${params.length + 1}`, label: "", path: "/spec/", type: "string" }])}>
              <Plus /> Custom (JSON pointer)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {params.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-center text-sm">
          No parameters: VMs are deployed exactly as defined.
        </p>
      ) : (
        params.map((p, i) => (
          <div
            key={i}
            className={cn("grid gap-3 rounded-lg border p-3", issues.some((x) => x.path.startsWith(`/parameters/${i}/`)) && "border-destructive/50")}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_170px_auto]">
              <Field label="Label">
                {(id) => (
                  <Input
                    id={id}
                    value={p.label ?? ""}
                    placeholder="Shown in the deploy form"
                    onChange={(e) => update(i, { label: e.target.value || undefined })}
                  />
                )}
              </Field>
              <Field label="Name" error={err(i, "name")}>
                {(id) => <Input id={id} className="font-mono text-sm" value={p.name} onChange={(e) => update(i, { name: e.target.value })} />}
              </Field>
              <Field label="Type">
                {(id) => (
                  <Select value={p.type} onValueChange={(v) => update(i, { type: v as ParameterType, default: undefined })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARAMETER_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive self-end"
                aria-label="Remove parameter"
                onClick={() => onChange(params.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Field (JSON pointer)" error={err(i, "path")}>
                {(id) => <Input id={id} className="font-mono text-sm" value={p.path} onChange={(e) => update(i, { path: e.target.value })} />}
              </Field>
              {p.type === "enum" ? (
                <Field label="Options" error={err(i, "options")}>
                  {() => <TagInput value={p.options ?? []} onChange={(options) => update(i, { options })} placeholder="Add option…" />}
                </Field>
              ) : p.type === "integer" || p.type === "quantity" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min">
                    {(id) => (
                      <Input
                        id={id}
                        value={p.min !== undefined ? String(p.min) : ""}
                        onChange={(e) => update(i, { min: e.target.value === "" ? undefined : p.type === "integer" ? Number(e.target.value) : e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Max">
                    {(id) => (
                      <Input
                        id={id}
                        value={p.max !== undefined ? String(p.max) : ""}
                        onChange={(e) => update(i, { max: e.target.value === "" ? undefined : p.type === "integer" ? Number(e.target.value) : e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              ) : p.type === "string" ? (
                <Field label="Pattern (regex)">
                  {(id) => (
                    <Input
                      id={id}
                      className="font-mono text-sm"
                      value={p.pattern ?? ""}
                      onChange={(e) => update(i, { pattern: e.target.value || undefined })}
                    />
                  )}
                </Field>
              ) : (
                <div />
              )}
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Checkbox checked={!!p.required} onCheckedChange={(v) => update(i, { required: v ? true : undefined })} /> Required
              </label>
            </div>
            <Field label="Help text">
              {(id) => <Input id={id} value={p.description ?? ""} onChange={(e) => update(i, { description: e.target.value || undefined })} />}
            </Field>
            {err(i, "default") && <p className="text-destructive text-xs">{err(i, "default")}</p>}
            <p className="text-muted-foreground text-xs">
              {p.required ? "Users must provide a value." : "Pre-filled with the value defined in the template; users may change it."}
            </p>
          </div>
        ))
      )}
    </SectionCard>
  );
}

export function TemplateEditor({
  initial,
  mode,
  namespaces,
  onSubmit,
  onCancel,
  serverError,
}: {
  initial: TemplateDraft;
  mode: "create" | "edit";
  namespaces: string[];
  onSubmit: (t: TemplateDraft) => Promise<unknown>;
  onCancel: () => void;
  serverError?: unknown;
}) {
  const [t, setT] = useState<TemplateDraft>(initial);
  const [view, setView] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState("");
  const [yamlError, setYamlError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const issues = useMemo<ValidationIssue[]>(() => {
    const out: ValidationIssue[] = [];
    if (!DNS1123_LABEL.test(t.name) || t.name.length > 58) out.push({ path: "/name", message: "Lowercase letters, digits and '-' (max 58)" });
    if (!t.displayName.trim()) out.push({ path: "/displayName", message: "Display name is required" });
    const pr = TemplateParametersSchema.safeParse(t.parameters);
    if (!pr.success) out.push(...zodIssues(pr.error).map((i) => ({ ...i, path: `/parameters${i.path}` })));
    out.push(...validateTemplateVM(t));
    out.push(...errorIssues(serverError));
    return out;
  }, [t, serverError]);
  const shown = touched ? issues : issues.filter((i) => i.path.startsWith("/parameters"));
  const err = (p: string) => shown.find((i) => i.path === p)?.message;

  const toYaml = () =>
    stringify(
      { name: t.name, displayName: t.displayName, description: t.description, tags: t.tags, osType: t.osType, parameters: t.parameters, vm: t.vm },
      { lineWidth: 0 },
    );
  const switchView = (v: "form" | "yaml") => {
    if (v === view || (v === "form" && yamlError)) return;
    if (v === "yaml") setYamlText(toYaml());
    setView(v);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" variant="outline" value={view} onValueChange={(v) => v && switchView(v as "form")}>
          <ToggleGroupItem value="form">
            <FileText /> Form
          </ToggleGroupItem>
          <ToggleGroupItem value="yaml">
            <Code2 /> YAML
          </ToggleGroupItem>
        </ToggleGroup>
        <Badge variant="secondary" className="gap-1">
          <Variable className="size-3" /> {t.parameters.length} parameter(s)
        </Badge>
      </div>
      {view === "form" ? (
        <>
          <SectionCard id="template" icon={<FileText className="size-4" />} title="Template" description="How the template appears in the library">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" required error={err("/displayName")}>
                {(id) => (
                  <Input id={id} value={t.displayName} onChange={(e) => setT({ ...t, displayName: e.target.value })} placeholder="Ubuntu 24.04 – Medium" />
                )}
              </Field>
              <Field
                label="Template ID"
                required
                error={err("/name")}
                locked={mode === "edit" ? "The template ID cannot be changed" : undefined}
                hint={mode === "create" ? "Stored as ConfigMap vmt-<id>" : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={t.name}
                    disabled={mode === "edit"}
                    maxLength={58}
                    onChange={(e) => setT({ ...t, name: e.target.value.toLowerCase() })}
                    placeholder="ubuntu-2404-medium"
                  />
                )}
              </Field>
              <Field label="Namespace" required locked={mode === "edit" ? "The namespace cannot be changed" : undefined}>
                {(id) => (
                  <Select value={t.namespace} disabled={mode === "edit"} onValueChange={(v) => setT({ ...t, namespace: v })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Select a namespace" />
                    </SelectTrigger>
                    <SelectContent>
                      {namespaces.map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Operating system">
                {(id) => (
                  <Select value={t.osType} onValueChange={(v) => setT({ ...t, osType: v as TemplateDraft["osType"] })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Linux">Linux</SelectItem>
                      <SelectItem value="Windows">Windows</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Description" className="sm:col-span-2">
                {(id) => <Textarea id={id} rows={2} value={t.description ?? ""} onChange={(e) => setT({ ...t, description: e.target.value || undefined })} />}
              </Field>
              <Field label="Tags" className="sm:col-span-2">
                {() => <TagInput value={t.tags} onChange={(tags) => setT({ ...t, tags })} />}
              </Field>
            </div>
          </SectionCard>
          <ParametersBuilder params={t.parameters} onChange={(parameters) => setT({ ...t, parameters })} issues={shown} />
          <VMSpecEditor
            spec={t.vm.spec}
            onChange={(spec) => setT({ ...t, vm: { ...t.vm, spec } })}
            namespace={t.namespace}
            issues={shown}
            issuePrefix="/vm/spec"
            mode="template"
            paramToggle={(path, label) => <ParamToggle path={path} label={label} params={t.parameters} onChange={(parameters) => setT({ ...t, parameters })} />}
          />
        </>
      ) : (
        <div className="grid gap-2">
          <YamlEditor
            value={yamlText}
            onChange={(text) => {
              setYamlText(text);
              try {
                const doc = parse(text) as Partial<TemplateDraft>;
                if (!doc?.vm?.spec) throw new Error("vm.spec is required");
                setT({
                  ...t,
                  displayName: doc.displayName ?? "",
                  description: doc.description,
                  tags: doc.tags ?? [],
                  osType: doc.osType ?? "Other",
                  parameters: doc.parameters ?? [],
                  vm: { apiVersion: "vmm.v4.nutanix.com/v1alpha1", kind: "VirtualMachine", metadata: doc.vm.metadata ?? {}, spec: doc.vm.spec },
                  ...(mode === "create" && doc.name ? { name: doc.name } : {}),
                });
                setYamlError(undefined);
              } catch (e) {
                setYamlError((e as Error).message);
              }
            }}
            minHeight="560px"
            maxHeight="75vh"
          />
          {yamlError && <p className="text-destructive text-sm">YAML error: {yamlError}</p>}
        </div>
      )}

      <div className="bg-background/90 sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        {touched && issues.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-destructive flex items-center gap-1.5 text-sm">
                <AlertTriangle className="size-4" /> {issues.length} issue(s) to fix
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md">
              <ul>
                {issues.slice(0, 6).map((i) => (
                  <li key={i.path + i.message}>
                    {i.path}: {i.message}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground text-sm">The server validates the template with a dry-run of the rendered VM before saving.</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !!yamlError}
            onClick={async () => {
              setTouched(true);
              if (issues.filter((i) => !errorIssues(serverError).includes(i)).length) return;
              setBusy(true);
              try {
                await onSubmit(t);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} {mode === "create" ? "Create template" : "Save template"}
          </Button>
        </div>
      </div>
    </div>
  );
}
