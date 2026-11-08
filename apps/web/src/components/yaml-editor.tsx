import { yaml } from "@codemirror/lang-yaml";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror, { basicSetup } from "@uiw/react-codemirror";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export default function YamlEditor({
  value,
  onChange,
  readOnly,
  className,
  minHeight = "320px",
  maxHeight = "70vh",
  language = "yaml",
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: string;
  maxHeight?: string;
  language?: "yaml" | "text";
}) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={cn("overflow-hidden rounded-lg border text-[13px]", className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        editable={!readOnly}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        extensions={language === "yaml" ? [yaml()] : []}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
      />
    </div>
  );
}

/** Side-by-side (or unified on small screens) diff of two YAML documents. */
export function YamlDiff({ original, modified, className }: { original: string; modified: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const dark = resolvedTheme === "dark";
    const theme = EditorView.theme({ "&": { fontSize: "12.5px" }, ".cm-scroller": { maxHeight: "60vh" } }, { dark });
    const ext = [basicSetup({ foldGutter: false, highlightActiveLine: false }), yaml(), EditorState.readOnly.of(true), EditorView.editable.of(false), theme];
    const view = new MergeView({
      a: { doc: original, extensions: ext },
      b: { doc: modified, extensions: ext },
      parent: ref.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      highlightChanges: true,
      gutter: true,
    });
    return () => view.destroy();
  }, [original, modified, resolvedTheme]);
  return <div ref={ref} className={cn("overflow-auto rounded-lg border", className)} />;
}
