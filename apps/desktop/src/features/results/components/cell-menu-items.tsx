import { commands, type JsonValue } from "@odin-db/bindings";
import { ContextMenuItem, ContextMenuSeparator } from "@odin-db/ui/components/context-menu";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Filter,
  FilterX,
  ListChecks,
  PencilLine,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { compactEJson, type JsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { linkOf } from "@/lib/links";
import { toShellSyntax } from "@/lib/shell-syntax";
import type { ColumnActions, RowActions } from "./results-grid";

/** Commands for the cell under the pointer: copy, edit, filter by its value. */
export function CellMenuItems({
  row,
  field,
  actions,
  columnActions,
}: {
  row: JsonObject;
  field: string;
  actions: RowActions;
  columnActions: ColumnActions | undefined;
}) {
  const { t } = useTranslation("results");
  const value = row[field];
  return (
    <>
      {linkOf(value) && (
        <ContextMenuItem onSelect={() => openLink(value)}>
          <ExternalLink />
          {t("cell.openLink")}
        </ContextMenuItem>
      )}
      <ContextMenuItem
        disabled={value === undefined}
        onSelect={() => {
          if (value === undefined) return;
          void navigator.clipboard.writeText(toShellSyntax(value));
          toast.success(t("row.copied"));
        }}
      >
        <Copy />
        <span className="truncate">{t("cell.copy", { field })}</span>
      </ContextMenuItem>
      <ContextMenuItem
        disabled={value === undefined}
        onSelect={() => {
          if (value === undefined) return;
          // A condition to paste into another query: { field: value }.
          void navigator.clipboard.writeText(toShellSyntax({ [field]: value }, 0));
          toast.success(t("row.copied"));
        }}
      >
        <Filter />
        <span className="truncate">{t("cell.copyFilter", { field })}</span>
      </ContextMenuItem>
      {actions.onEditField && field !== "_id" && !field.includes(".") && (
        <ContextMenuItem onSelect={() => actions.onEditField?.(row, field)}>
          <PencilLine />
          <span className="truncate">{t("cell.edit", { field })}</span>
        </ContextMenuItem>
      )}
      {columnActions && (
        <ContextMenuItem onSelect={() => columnActions.onFilterBy(field, value)}>
          <Filter />
          <span className="truncate">{t("cell.filter", { field })}</span>
        </ContextMenuItem>
      )}
      {columnActions && (
        <ContextMenuItem onSelect={() => columnActions.onFilterBy(field, value, "ne")}>
          <FilterX />
          <span className="truncate">{t("cell.exclude", { field })}</span>
        </ContextMenuItem>
      )}
      {columnActions &&
        value !== undefined &&
        ["number", "date"].includes(compactEJson(value).kind) && (
          <>
            <ContextMenuItem onSelect={() => columnActions.onFilterBy(field, value, "gt")}>
              <ChevronRight />
              <span className="truncate">{t("cell.greater", { field })}</span>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => columnActions.onFilterBy(field, value, "lt")}>
              <ChevronLeft />
              <span className="truncate">{t("cell.less", { field })}</span>
            </ContextMenuItem>
          </>
        )}
      {columnActions?.onDistinct && (
        <ContextMenuItem onSelect={() => columnActions.onDistinct?.(field)}>
          <ListChecks />
          <span className="truncate">{t("cell.distinct", { field })}</span>
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  );
}

/** Opens a web or mail link found in a value; the backend checks it again. */
export function openLink(value: JsonValue | undefined) {
  const link = linkOf(value);
  if (link) void call(commands.openLink(link)).catch((error) => toast.error(errorMessage(error)));
}
