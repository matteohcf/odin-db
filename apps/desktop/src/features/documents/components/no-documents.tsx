import { Button } from "@odin-db/ui/components/button";
import { ClipboardPaste, Plus, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

/** What the results show when nothing matches: a way out of the filter, or ways to add documents. */
export function NoDocuments({
  filtered,
  isView,
  editable,
  onClearFilter,
  onInsert,
  onPaste,
  onImport,
}: {
  filtered: boolean;
  isView: boolean;
  editable: boolean;
  onClearFilter: () => void;
  onInsert: () => void;
  onPaste: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation("documents");
  return (
    <>
      <p>
        {filtered
          ? t("results.empty")
          : isView
            ? t("results.emptyView")
            : t("results.emptyCollection")}
      </p>
      {filtered ? (
        <Button size="sm" variant="outline" onClick={onClearFilter}>
          {t("results.clearFilter")}
        </Button>
      ) : (
        editable && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={onInsert}>
              <Plus />
              {t("insert")}
            </Button>
            <Button size="sm" variant="outline" onClick={onPaste}>
              <ClipboardPaste />
              {t("paste.menu")}
            </Button>
            <Button size="sm" variant="outline" onClick={onImport}>
              <Upload />
              {t("menu.import", { ns: "transfer" })}
            </Button>
          </div>
        )
      )}
    </>
  );
}
