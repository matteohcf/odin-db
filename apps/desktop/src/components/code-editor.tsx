import { cn } from "@odin-db/ui/lib/utils";
import { lazy, Suspense } from "react";
import type { CodeEditorProps } from "./code-editor-view";

// CodeMirror is one of the largest dependencies; it loads on the first editor shown.
const CodeEditorView = lazy(() => import("./code-editor-view"));

export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className={cn("bg-muted/40", props.className)} />}>
      <CodeEditorView {...props} />
    </Suspense>
  );
}
