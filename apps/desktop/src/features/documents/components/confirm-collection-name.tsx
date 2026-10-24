import type { Namespace } from "@odin-db/bindings";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { useId } from "react";
import { useTranslation } from "react-i18next";

interface ConfirmCollectionNameProps {
  namespace: Namespace;
  count: number;
  value: string;
  onChange: (value: string) => void;
}

/** Asks for the collection's name before a write to every document in it, as dropping does. */
export function ConfirmCollectionName({
  namespace,
  count,
  value,
  onChange,
}: ConfirmCollectionNameProps) {
  const { t } = useTranslation("documents");
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
      <Label htmlFor={id} className="text-destructive text-xs">
        {t("bulk.confirmAll", { name: namespace.collection, count })}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="h-8 font-mono text-xs"
      />
    </div>
  );
}
