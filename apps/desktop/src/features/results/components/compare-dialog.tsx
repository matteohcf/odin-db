import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Label } from "@odin-db/ui/components/label";
import { Switch } from "@odin-db/ui/components/switch";
import { cn } from "@odin-db/ui/lib/utils";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { compactEJson, type JsonObject } from "@/lib/ejson-display";
import { compareDocuments, type FieldDifference } from "../lib/compare";

const statusClass: Record<FieldDifference["status"], string> = {
  same: "",
  changed: "bg-warning/10",
  added: "bg-success/10",
  removed: "bg-destructive/10",
};

/** Two documents side by side, field by field, differences highlighted. */
export function CompareDialog({
  left,
  right,
  onClose,
}: {
  left: JsonObject;
  right: JsonObject;
  onClose: () => void;
}) {
  const { t } = useTranslation("results");
  const id = useId();
  const rows = useMemo(() => compareDocuments(left, right), [left, right]);
  const differences = rows.filter((row) => row.status !== "same").length;
  const [onlyDifferences, setOnlyDifferences] = useState(differences > 0);
  const shown = onlyDifferences ? rows.filter((row) => row.status !== "same") : rows;
  const title = (document: JsonObject) =>
    document._id === undefined ? "—" : compactEJson(document._id).text;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("compare.title")}</DialogTitle>
          <DialogDescription>
            {differences === 0
              ? t("compare.identical")
              : t("compare.summary", { count: differences, total: rows.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-only`}
            checked={onlyDifferences}
            onCheckedChange={setOnlyDifferences}
          />
          <Label htmlFor={`${id}-only`} className="text-xs">
            {t("compare.onlyDifferences")}
          </Label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <table className="w-full table-fixed border-collapse font-mono text-xs">
            <thead className="sticky top-0 bg-sidebar text-left text-muted-foreground">
              <tr>
                <th className="w-1/4 border-b px-2 py-1.5 font-medium">{t("compare.field")}</th>
                <th className="border-b px-2 py-1.5 font-medium">{title(left)}</th>
                <th className="border-b px-2 py-1.5 font-medium">{title(right)}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.path} data-status={row.status} className={statusClass[row.status]}>
                  <td className="truncate border-b px-2 py-1 align-top" title={row.path}>
                    {row.path}
                  </td>
                  <td className="border-b px-2 py-1 align-top break-all selectable">
                    {row.left ?? (
                      <span className="text-muted-foreground">{t("compare.missing")}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "border-b px-2 py-1 align-top break-all selectable",
                      row.status !== "same" && "font-semibold",
                    )}
                  >
                    {row.right ?? (
                      <span className="text-muted-foreground">{t("compare.missing")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
