import { type ConnectionId, commands } from "@odin-db/bindings";
import { Label } from "@odin-db/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { call } from "@/lib/ipc";
import type { CompareSide, CompareTarget } from "../lib/target";

interface TargetPickerProps {
  targets: readonly CompareTarget[];
  value: Partial<CompareSide>;
  onChange: (value: Partial<CompareSide>) => void;
  disabled?: boolean;
  /** Whole databases are compared without picking a collection. */
  withCollection?: boolean;
}

/** Connection, database and collection to compare with, each listing what exists. */
export function TargetPicker({
  targets,
  value,
  onChange,
  disabled,
  withCollection = true,
}: TargetPickerProps) {
  const { t } = useTranslation("compare");
  const id = useId();
  const { connectionId, database } = value;
  const databases = useQuery({
    queryKey: ["compare-databases", connectionId],
    queryFn: () => call(commands.listDatabases(connectionId as ConnectionId)),
    enabled: connectionId !== undefined,
  });
  const collections = useQuery({
    queryKey: ["compare-collections", connectionId, database],
    queryFn: () => call(commands.listCollections(connectionId as ConnectionId, database ?? "")),
    enabled: withCollection && connectionId !== undefined && Boolean(database),
  });
  const field = "flex min-w-0 flex-1 flex-col gap-1.5";

  return (
    <div className="flex gap-2">
      <div className={field}>
        <Label htmlFor={`${id}-connection`} className="text-xs">
          {t("target.connection")}
        </Label>
        <Select
          value={connectionId ?? ""}
          onValueChange={(next) => onChange({ connectionId: next as ConnectionId })}
          disabled={disabled}
        >
          <SelectTrigger id={`${id}-connection`} size="sm" className="w-full">
            <SelectValue placeholder={t("target.pickConnection")} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((target) => (
              <SelectItem key={target.connectionId} value={target.connectionId}>
                {target.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={field}>
        <Label htmlFor={`${id}-database`} className="text-xs">
          {t("target.database")}
        </Label>
        <Select
          value={database ?? ""}
          onValueChange={(next) =>
            onChange({ ...(connectionId ? { connectionId } : {}), database: next })
          }
          disabled={disabled || !databases.data}
        >
          <SelectTrigger id={`${id}-database`} size="sm" className="w-full">
            <SelectValue placeholder={t("target.pickDatabase")} />
          </SelectTrigger>
          <SelectContent>
            {databases.data?.map((entry) => (
              <SelectItem key={entry.name} value={entry.name}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {withCollection && (
        <div className={field}>
          <Label htmlFor={`${id}-collection`} className="text-xs">
            {t("target.collection")}
          </Label>
          <Select
            value={value.collection ?? ""}
            onValueChange={(next) => onChange({ ...value, collection: next })}
            disabled={disabled || !collections.data}
          >
            <SelectTrigger id={`${id}-collection`} size="sm" className="w-full">
              <SelectValue placeholder={t("target.pickCollection")} />
            </SelectTrigger>
            <SelectContent>
              {collections.data
                ?.filter((entry) => entry.kind !== "view")
                .map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>
                    {entry.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
