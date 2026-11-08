import { Field } from "@/components/form";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Credential = { mode: "basic"; username: string; password: string } | { mode: "apiKey"; apiKey: string };

export function CredentialFields({ value, onChange, showErrors }: { value: Credential; onChange: (c: Credential) => void; showErrors?: boolean }) {
  return (
    <div className="grid gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={value.mode}
        onValueChange={(m) => m && onChange(m === "basic" ? { mode: "basic", username: "", password: "" } : { mode: "apiKey", apiKey: "" })}
        className="justify-start"
      >
        <ToggleGroupItem value="basic" className="px-3">
          Username & password
        </ToggleGroupItem>
        <ToggleGroupItem value="apiKey" className="px-3">
          API key
        </ToggleGroupItem>
      </ToggleGroup>
      {value.mode === "basic" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" required error={showErrors && !value.username ? "Required" : undefined}>
            {(id) => <Input id={id} autoComplete="off" value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })} />}
          </Field>
          <Field label="Password" required error={showErrors && !value.password ? "Required" : undefined}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={value.password}
                onChange={(e) => onChange({ ...value, password: e.target.value })}
              />
            )}
          </Field>
        </div>
      ) : (
        <Field label="API key" required hint="A Prism Central service account API key" error={showErrors && !value.apiKey ? "Required" : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="off" value={value.apiKey} onChange={(e) => onChange({ ...value, apiKey: e.target.value })} />}
        </Field>
      )}
    </div>
  );
}
