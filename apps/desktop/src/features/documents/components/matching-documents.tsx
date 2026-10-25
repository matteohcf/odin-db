import type { EJsonDocument } from "@odin-db/bindings";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isJsonObject } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { toShellSyntax } from "@/lib/shell-syntax";
import type { useMatchingCount } from "../api/queries";

// Matches core's documents::UNDO_LIMIT: past it a write keeps no originals to undo with.
const UNDO_LIMIT = 1000;

interface MatchingDocumentsProps {
  filter: EJsonDocument;
  count: ReturnType<typeof useMatchingCount>;
  /** The write keeps the documents to undo it, up to a limit worth warning about. */
  undoable?: boolean;
}

/** The filter a write by filter applies to, and how many documents match it. */
export function MatchingDocuments({ filter, count, undoable = false }: MatchingDocumentsProps) {
  const { t } = useTranslation("documents");
  const matchAll = isJsonObject(filter) && Object.keys(filter).length === 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-sm">{t("bulk.filter")}</span>
      <code className="truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs selectable">
        {matchAll ? t("bulk.allDocuments") : toShellSyntax(filter, 0)}
      </code>
      <p
        role="status"
        className="flex items-center gap-1.5 text-muted-foreground text-xs tabular-nums"
      >
        {count.isPending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {t("bulk.counting")}
          </>
        ) : count.error ? (
          t("bulk.countFailed", { message: errorMessage(count.error) })
        ) : (
          t("bulk.matching", { count: count.data ?? 0 })
        )}
      </p>
      {undoable && (count.data ?? 0) > UNDO_LIMIT && (
        <p className="text-warning text-xs">{t("bulk.noUndo")}</p>
      )}
    </div>
  );
}
