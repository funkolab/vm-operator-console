import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const YamlEditorImpl = lazy(() => import("./yaml-editor"));
const YamlDiffImpl = lazy(() => import("./yaml-editor").then((m) => ({ default: m.YamlDiff })));

type EditorProps = Parameters<typeof import("./yaml-editor").default>[0];
type DiffProps = Parameters<typeof import("./yaml-editor").YamlDiff>[0];

/** Code editor loaded on demand to keep CodeMirror out of the initial bundle. */
export function YamlEditor(props: EditorProps) {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <YamlEditorImpl {...props} />
    </Suspense>
  );
}

export function YamlDiff(props: DiffProps) {
  return (
    <Suspense fallback={<Skeleton className="h-60 w-full" />}>
      <YamlDiffImpl {...props} />
    </Suspense>
  );
}
