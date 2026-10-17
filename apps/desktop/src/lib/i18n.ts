import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import app from "@/app/locales/en.json";
import aggregation from "@/features/aggregation/locales/en.json";
import backup from "@/features/backup/locales/en.json";
import backups from "@/features/backups/locales/en.json";
import collection from "@/features/collection/locales/en.json";
import connections from "@/features/connections/locales/en.json";
import documents from "@/features/documents/locales/en.json";
import indexes from "@/features/indexes/locales/en.json";
import perfLab from "@/features/perf-lab/locales/en.json";
import results from "@/features/results/locales/en.json";
import schema from "@/features/schema/locales/en.json";
import shell from "@/features/shell/locales/en.json";
import transfer from "@/features/transfer/locales/en.json";
import workspace from "@/features/workspace/locales/en.json";
import common from "@/locales/en.json";

export const resources = {
  en: {
    aggregation,
    app,
    backup,
    backups,
    collection,
    common,
    connections,
    documents,
    indexes,
    perfLab,
    results,
    schema,
    shell,
    transfer,
    workspace,
  },
} as const;

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: Object.keys(resources.en),
  defaultNS: "common",
  resources,
  interpolation: { escapeValue: false },
});
