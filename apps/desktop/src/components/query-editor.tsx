import { cn } from "@odin-db/ui/lib/utils";
import { lazy, Suspense } from "react";
import type { QueryEditorProps } from "./query-editor-view";

// Shares the lazily loaded CodeMirror chunk with the document editor.
const QueryEditorView = lazy(() => import("./query-editor-view"));

export function QueryEditor(props: QueryEditorProps) {
  return (
    <Suspense
      fallback={
        <span className={cn("flex-1 truncate font-mono text-xs leading-[30px]", props.className)}>
          {props.value}
        </span>
      }
    >
      <QueryEditorView {...props} />
    </Suspense>
  );
}
