import "i18next";
import type { resources } from "./i18n";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "app";
    resources: (typeof resources)["en"];
  }
}
