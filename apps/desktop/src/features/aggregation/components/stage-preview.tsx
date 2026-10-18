import type { ConnectionId, Namespace } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { describeEJson } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import {
  PREVIEW_LIMIT,
  PREVIEW_SAMPLE,
  StageSyntaxError,
  useStagePreview,
} from "../api/use-stage-preview";
import { isWriteOperator } from "../lib/operators";
import type { Stage } from "../lib/pipeline";

export function StagePreview({
  connectionId,
  namespace,
  stages,
  index,
}: {
  connectionId: ConnectionId;
  namespace: Namespace;
  stages: readonly Stage[];
  index: number;
}) {
  const { t } = useTranslation("aggregation");
  const stage = stages[index];
  const preview = useStagePreview(connectionId, namespace, stages, index);
  const writes = stages.slice(0, index + 1).some((s) => s.enabled && isWriteOperator(s.operator));

  let body: ReactNode;
  if (!stage?.enabled) body = <Note>{t("stage.disabled")}</Note>;
  else if (writes) body = <Note>{t("preview.writeStage")}</Note>;
  else if (preview.error) {
    const error = preview.error;
    const failing =
      error instanceof StageSyntaxError ? stages.findIndex((s) => s.id === error.stageId) : -1;
    body = (
      <Note tone="error">
        {failing >= 0 && failing !== index
          ? t("preview.fixStage", { number: failing + 1 })
          : t("preview.failed", { message: errorMessage(error) })}
      </Note>
    );
  } else if (!preview.data) body = <Note>{t("preview.loading")}</Note>;
  else if (preview.data.length === 0) body = <Note>{t("preview.empty")}</Note>;
  else {
    body = (
      <ol className="flex flex-col gap-1 p-2">
        {preview.data.map((document, position) => {
          const text = describeEJson(document).text;
          return (
            // Preview rows are positional snapshots without stable ids, replaced as a whole.
            <li
              key={position}
              title={text}
              className="truncate rounded-sm bg-muted/60 px-2 py-1 font-mono text-[11px] selectable"
            >
              {text}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="flex h-44 min-w-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-muted-foreground text-xs">
        {preview.data && stage?.enabled && !writes ? (
          <>
            <span className="text-foreground">
              {t("preview.title", { count: preview.data.length })}
            </span>
            <span className="truncate">
              {t("preview.sampleNote", {
                limit: PREVIEW_LIMIT,
                sample: PREVIEW_SAMPLE.toLocaleString(),
              })}
            </span>
          </>
        ) : null}
        {preview.isFetching && <Loader2 className="ml-auto size-3 animate-spin" />}
      </div>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable to scroll from the keyboard (WCAG 2.1.1).
        tabIndex={0}
        aria-label={t("preview.label")}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {body}
      </section>
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 p-3 text-xs",
        tone === "error" ? "text-destructive selectable" : "text-muted-foreground",
      )}
    >
      {tone === "error" && <CircleAlert className="mt-px size-3.5 shrink-0" />}
      {children}
    </p>
  );
}
