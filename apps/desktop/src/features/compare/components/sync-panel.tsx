import type { CompareSummary } from "@odin-db/bindings";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { TriangleAlert } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { SyncOptions } from "../hooks/use-sync";

interface SyncPanelProps {
  summary: CompareSummary;
  /** Where the changes go, e.g. "Staging · shop.users". */
  targetLabel: string;
  /** The target collection's name, typed to confirm deletes. */
  collection: string;
  options: SyncOptions;
  onOptionsChange: (options: SyncOptions) => void;
  confirmation: string;
  onConfirmationChange: (text: string) => void;
  disabled: boolean;
}

/** What a sync will change on the right, chosen per kind of difference. */
export function SyncPanel({
  summary,
  targetLabel,
  collection,
  options,
  onOptionsChange,
  confirmation,
  onConfirmationChange,
  disabled,
}: SyncPanelProps) {
  const { t, i18n } = useTranslation("compare");
  const id = useId();
  const number = (value: number | null) => (value ?? 0).toLocaleString(i18n.language);
  const choices = [
    { key: "insertMissing", count: summary.onlyLeft },
    { key: "replaceDifferent", count: summary.different },
    { key: "deleteExtra", count: summary.onlyRight },
  ] as const;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm">{t("sync.intro", { target: targetLabel })}</p>
      {choices.map((choice) => (
        <div key={choice.key} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${choice.key}`}
            checked={options[choice.key]}
            disabled={disabled || !choice.count}
            onCheckedChange={(checked) =>
              onOptionsChange({ ...options, [choice.key]: checked === true })
            }
          />
          <Label
            htmlFor={`${id}-${choice.key}`}
            className={choice.key === "deleteExtra" ? "text-destructive" : undefined}
          >
            {t(`sync.${choice.key}`, { count: choice.count ?? 0, formatted: number(choice.count) })}
          </Label>
        </div>
      ))}
      {options.deleteExtra && (
        <div className="flex flex-col gap-1.5 rounded-md bg-destructive/10 p-2.5">
          <p className="flex items-start gap-1.5 text-destructive text-xs">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            {t("sync.deleteWarning", { collection })}
          </p>
          <Input
            aria-label={t("sync.confirmLabel")}
            value={confirmation}
            onChange={(event) => onConfirmationChange(event.target.value)}
            placeholder={collection}
            spellCheck={false}
            disabled={disabled}
            className="h-8 font-mono text-xs"
          />
        </div>
      )}
    </div>
  );
}
