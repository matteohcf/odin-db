import { useTranslation } from "react-i18next";
import type { QueryText } from "../lib/query-text";

const PARTS = ["filter", "sort", "projection", "limit"] as const;

/** The generated query, part by part, as it will appear in the query bar. */
export function QueryPreview({ text }: { text: QueryText }) {
  const { t } = useTranslation("ai");
  return (
    <dl
      aria-label={t("ask.result")}
      className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-xs"
    >
      {PARTS.map((part) =>
        part === "filter" || text[part] ? (
          <div key={part} className="contents">
            <dt className="text-muted-foreground">{t(`ask.parts.${part}`)}</dt>
            <dd className="break-all font-mono selectable">{text[part] || "{}"}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
