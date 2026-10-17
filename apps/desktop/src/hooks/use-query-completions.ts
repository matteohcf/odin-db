import type { CompletionSource } from "@codemirror/autocomplete";
import type { FieldSummary } from "@odin-db/bindings";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type QueryKind, queryCompletionSource } from "@/lib/query-completion";
import locale from "@/locales/en.json";

type HelpKey = keyof typeof locale.queryAssist.help;

/**
 * Completion sources per query kind, localized. Sources are stable for the
 * editors' lifetime and always read the latest `fields`.
 */
export function useQueryCompletions(fields: readonly FieldSummary[]) {
  const { t } = useTranslation();
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  return useMemo(() => {
    const describe = (label: string) => {
      const key = label.replace(/^\$/, "");
      return key in locale.queryAssist.help ? t(`queryAssist.help.${key as HelpKey}`) : undefined;
    };
    const labels = {
      fields: t("queryAssist.sections.fields"),
      operators: t("queryAssist.sections.operators"),
      values: t("queryAssist.sections.values"),
    };
    const sources = new Map<QueryKind, CompletionSource>();
    return (kind: QueryKind) => {
      let source = sources.get(kind);
      if (!source) {
        source = queryCompletionSource({ kind, fields: () => fieldsRef.current, describe, labels });
        sources.set(kind, source);
      }
      return source;
    };
  }, [t]);
}
