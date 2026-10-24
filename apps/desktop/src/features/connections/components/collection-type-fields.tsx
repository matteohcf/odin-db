import { Input } from "@odin-db/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FormField } from "@/components/form-field";
import {
  COLLECTION_TYPES,
  type CollectionDraft,
  type CollectionType,
  type DraftErrors,
  type DraftField,
  GRANULARITIES,
} from "../lib/collection-options";

interface CollectionTypeFieldsProps {
  draft: CollectionDraft;
  errors: DraftErrors;
  onChange: (changes: Partial<CollectionDraft>) => void;
}

/** The type of a new collection and the settings that type takes. */
export function CollectionTypeFields({ draft, errors, onChange }: CollectionTypeFieldsProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  const text = (field: DraftField, options: { numeric?: boolean; placeholder?: string } = {}) => (
    <Input
      id={`${id}-${field}`}
      value={draft[field]}
      onChange={(event) => onChange({ [field]: event.target.value })}
      aria-invalid={errors[field] !== undefined}
      inputMode={options.numeric ? "decimal" : undefined}
      placeholder={options.placeholder}
      autoComplete="off"
      spellCheck={false}
      className="font-mono"
    />
  );
  const field = (name: DraftField, input: ReturnType<typeof text>, hint?: string) => (
    <FormField
      id={`${id}-${name}`}
      label={t(`catalog.create.fields.${name}` as const)}
      hint={hint}
      error={errors[name]}
    >
      {input}
    </FormField>
  );
  const expiry = field(
    "expireAfterSeconds",
    text("expireAfterSeconds", { numeric: true }),
    t("catalog.create.expireHint"),
  );

  return (
    <div className="flex flex-col gap-4">
      <FormField
        id={`${id}-type`}
        label={t("catalog.create.fields.type")}
        hint={t(`catalog.create.types.${draft.type}.hint` as const)}
      >
        <Select
          value={draft.type}
          onValueChange={(type) => onChange({ type: type as CollectionType })}
        >
          <SelectTrigger id={`${id}-type`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLLECTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`catalog.create.types.${type}.label` as const)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      {draft.type === "capped" && (
        <div className="grid grid-cols-2 gap-3">
          {field("sizeMb", text("sizeMb", { numeric: true }))}
          {field(
            "maxDocuments",
            text("maxDocuments", { numeric: true, placeholder: t("catalog.create.optional") }),
          )}
        </div>
      )}
      {draft.type === "timeSeries" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {field("timeField", text("timeField", { placeholder: "timestamp" }))}
            {field("metaField", text("metaField", { placeholder: t("catalog.create.optional") }))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id={`${id}-granularity`} label={t("catalog.create.fields.granularity")}>
              <Select
                value={draft.granularity || "auto"}
                onValueChange={(value) =>
                  onChange({
                    granularity: value === "auto" ? "" : (value as CollectionDraft["granularity"]),
                  })
                }
              >
                <SelectTrigger id={`${id}-granularity`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("catalog.create.granularity.auto")}</SelectItem>
                  {GRANULARITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`catalog.create.granularity.${value}` as const)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {expiry}
          </div>
        </>
      )}
      {draft.type === "clustered" && expiry}

      {field(
        "collation",
        text("collation", { placeholder: '{ locale: "en", strength: 2 }' }),
        t("catalog.create.collationHint"),
      )}
    </div>
  );
}
