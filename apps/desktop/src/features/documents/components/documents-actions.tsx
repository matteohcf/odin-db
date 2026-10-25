import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import {
  ClipboardPaste,
  Code2,
  DatabaseZap,
  Download,
  FilePen,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface DocumentsActionsProps {
  editable: boolean;
  /** The collection is a GridFS bucket's files: offer an upload. */
  gridFs: boolean;
  onUpload: () => void;
  onInsert: () => void;
  onImport: () => void;
  onExport: () => void;
  onBulk: (mode: "update" | "delete") => void;
  onPaste: () => void;
  onSql: () => void;
  onCode: () => void;
}

/** The documents view's actions after Run: upload, insert, and the rest in a menu. */
export function DocumentsActions({
  editable,
  gridFs,
  onUpload,
  onInsert,
  onImport,
  onExport,
  onBulk,
  onPaste,
  onSql,
  onCode,
}: DocumentsActionsProps) {
  const { t } = useTranslation("documents");
  return (
    <>
      {editable && gridFs && (
        <Button
          variant="outline"
          size="sm"
          aria-label={t("gridfs.upload")}
          title={t("gridfs.upload")}
          onClick={onUpload}
        >
          <Upload />
          <span className="hidden @4xl:inline">{t("gridfs.upload")}</span>
        </Button>
      )}
      {editable && (
        <Button
          variant="outline"
          size="sm"
          aria-label={t("insert")}
          title={t("insert")}
          onClick={onInsert}
        >
          <Plus />
          <span className="hidden @4xl:inline">{t("insert")}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("menu.more", { ns: "transfer" })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {editable && (
            <DropdownMenuItem onSelect={onImport}>
              <Upload />
              {t("menu.import", { ns: "transfer" })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onExport}>
            <Download />
            {t("menu.export", { ns: "transfer" })}
          </DropdownMenuItem>
          {editable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onBulk("update")}>
                <FilePen />
                {t("bulk.menuUpdate")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => onBulk("delete")}>
                <Trash2 />
                {t("bulk.menuDelete")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {editable && (
            <DropdownMenuItem onSelect={onPaste}>
              <ClipboardPaste />
              {t("paste.menu")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onSql}>
            <DatabaseZap />
            {t("sql.menu")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCode}>
            <Code2 />
            {t("queryCode.menu", { ns: "common" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
