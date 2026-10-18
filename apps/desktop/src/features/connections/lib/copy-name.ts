import i18n from "i18next";
import { toast } from "sonner";

/** Copies a database or collection name, confirming with a toast. */
export function copyName(name: string) {
  void navigator.clipboard.writeText(name);
  toast.success(i18n.t("tree.nameCopied", { ns: "connections", name }));
}
