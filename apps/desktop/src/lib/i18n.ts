import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import app from "@/app/locales/en.json";
import appIt from "@/app/locales/it.json";
import aggregation from "@/features/aggregation/locales/en.json";
import aggregationIt from "@/features/aggregation/locales/it.json";
import ai from "@/features/ai/locales/en.json";
import aiIt from "@/features/ai/locales/it.json";
import backup from "@/features/backup/locales/en.json";
import backupIt from "@/features/backup/locales/it.json";
import backups from "@/features/backups/locales/en.json";
import backupsIt from "@/features/backups/locales/it.json";
import collection from "@/features/collection/locales/en.json";
import collectionIt from "@/features/collection/locales/it.json";
import connections from "@/features/connections/locales/en.json";
import connectionsIt from "@/features/connections/locales/it.json";
import documents from "@/features/documents/locales/en.json";
import documentsIt from "@/features/documents/locales/it.json";
import indexes from "@/features/indexes/locales/en.json";
import indexesIt from "@/features/indexes/locales/it.json";
import monitor from "@/features/monitor/locales/en.json";
import monitorIt from "@/features/monitor/locales/it.json";
import perfLab from "@/features/perf-lab/locales/en.json";
import perfLabIt from "@/features/perf-lab/locales/it.json";
import results from "@/features/results/locales/en.json";
import resultsIt from "@/features/results/locales/it.json";
import schema from "@/features/schema/locales/en.json";
import schemaIt from "@/features/schema/locales/it.json";
import settings from "@/features/settings/locales/en.json";
import settingsIt from "@/features/settings/locales/it.json";
import shell from "@/features/shell/locales/en.json";
import shellIt from "@/features/shell/locales/it.json";
import transfer from "@/features/transfer/locales/en.json";
import transferIt from "@/features/transfer/locales/it.json";
import updates from "@/features/updates/locales/en.json";
import updatesIt from "@/features/updates/locales/it.json";
import users from "@/features/users/locales/en.json";
import usersIt from "@/features/users/locales/it.json";
import workspace from "@/features/workspace/locales/en.json";
import workspaceIt from "@/features/workspace/locales/it.json";
import { type Settings, useSettings } from "@/lib/settings";
import common from "@/locales/en.json";
import commonIt from "@/locales/it.json";

export const resources = {
  en: {
    aggregation,
    ai,
    app,
    backup,
    backups,
    collection,
    common,
    connections,
    documents,
    indexes,
    monitor,
    perfLab,
    results,
    schema,
    settings,
    shell,
    transfer,
    updates,
    users,
    workspace,
  },
  it: {
    aggregation: aggregationIt,
    ai: aiIt,
    app: appIt,
    backup: backupIt,
    backups: backupsIt,
    collection: collectionIt,
    common: commonIt,
    connections: connectionsIt,
    documents: documentsIt,
    indexes: indexesIt,
    monitor: monitorIt,
    perfLab: perfLabIt,
    results: resultsIt,
    schema: schemaIt,
    settings: settingsIt,
    shell: shellIt,
    transfer: transferIt,
    updates: updatesIt,
    users: usersIt,
    workspace: workspaceIt,
  },
} as const;

export type Language = keyof typeof resources;

/** Native names, shown untranslated so anyone can find their language. */
export const LANGUAGES: Record<Language, string> = { en: "English", it: "Italiano" };

/** The language to show for a setting: "system" follows the OS, falling back to English. */
export function resolveLanguage(
  setting: Settings["language"],
  system = navigator.language,
): Language {
  if (setting !== "system") return setting;
  const code = system.split("-")[0];
  return code && code in resources ? (code as Language) : "en";
}

void i18n.use(initReactI18next).init({
  lng: resolveLanguage(useSettings.getState().language),
  fallbackLng: "en",
  ns: Object.keys(resources.en),
  defaultNS: "common",
  resources,
  interpolation: { escapeValue: false },
});
