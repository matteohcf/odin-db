import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import app from "@/app/locales/en.json";
import connections from "@/features/connections/locales/en.json";
import documents from "@/features/documents/locales/en.json";
import perfLab from "@/features/perf-lab/locales/en.json";
import workspace from "@/features/workspace/locales/en.json";
import common from "@/locales/en.json";

export const resources = {
  en: { app, common, connections, documents, perfLab, workspace },
} as const;

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: Object.keys(resources.en),
  defaultNS: "common",
  resources,
  interpolation: { escapeValue: false },
});
