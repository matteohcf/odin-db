import type { DatabaseTransferSummary } from "@odin-db/bindings";
import { useTranslation } from "react-i18next";

/** Outcome of a multi-collection import or copy: totals, then the first errors. */
export function DatabaseTransferResult({
  summary,
  done,
}: {
  summary: DatabaseTransferSummary;
  done: string;
}) {
  const { t } = useTranslation("transfer");
  const failed = summary.failed ?? 0;
  return (
    <>
      <p className={failed === 0 && summary.errors.length === 0 ? "text-success" : undefined}>
        {done}
      </p>
      {failed > 0 && (
        <p className="text-destructive">{t("database.import.failedCount", { count: failed })}</p>
      )}
      {summary.errors.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border p-2 font-mono text-xs selectable">
          {summary.errors.map((error) => (
            <li key={error} className="break-words">
              {error}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
