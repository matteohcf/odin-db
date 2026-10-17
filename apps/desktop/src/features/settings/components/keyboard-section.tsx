import { useTranslation } from "react-i18next";
import { ShortcutsList } from "@/components/shortcuts-list";

export function KeyboardSection() {
  const { t } = useTranslation("settings");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-semibold text-base">{t("keyboard.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("keyboard.description")}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <ShortcutsList />
      </div>
    </section>
  );
}
