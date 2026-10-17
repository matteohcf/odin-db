import type { JsonValue } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { ChevronsDownUp, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { compactEJson, type JsonObject } from "@/lib/ejson-display";
import { useResultsView } from "../store/results-view-store";
import { DocumentTree } from "./document-tree";

/** The selected document beside the table: wide or nested documents read at a glance. */
export function DocumentPreview({
  document,
  onFilter,
}: {
  document: JsonObject | undefined;
  onFilter?: ((path: string, value: JsonValue) => void) | undefined;
}) {
  const { t } = useTranslation("results");
  const togglePreview = useResultsView((s) => s.togglePreview);
  const [expanded, setExpanded] = useState(false);
  const id = document?._id;
  return (
    <aside
      aria-label={t("preview.label")}
      className="flex w-[380px] shrink-0 flex-col border-l bg-background"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-sidebar pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
          {id === undefined ? t("preview.title") : compactEJson(id).text}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          disabled={!document}
          aria-label={expanded ? t("preview.collapse") : t("preview.expand")}
          title={expanded ? t("preview.collapse") : t("preview.expand")}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronsDownUp className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label={t("preview.close")}
          title={t("preview.close")}
          onClick={togglePreview}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 selectable">
        {document ? (
          // Remounted per document and on expand/collapse all, which set the initial state.
          <DocumentTree
            key={`${JSON.stringify(id)}:${expanded}`}
            document={document}
            expanded={expanded}
            onFilter={onFilter}
          />
        ) : (
          <p className="text-muted-foreground text-xs">{t("preview.empty")}</p>
        )}
      </div>
    </aside>
  );
}
