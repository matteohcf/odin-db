import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import app from "../app/locales/en.json";
import perfLab from "../features/perf-lab/locales/en.json";

export const resources = { en: { app, perfLab } } as const;

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["app", "perfLab"],
  defaultNS: "app",
  resources,
  interpolation: { escapeValue: false },
});
