import { commands } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import { useTheme } from "@odin-db/ui/components/theme-provider";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OdinAppIcon } from "@/components/odin-app-icon";
import { useSettings } from "@/lib/settings";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";
import { UpdateRow } from "./update-row";

const REPOSITORY = "https://github.com/matteohcf/odin-db";

export function AboutSection() {
  const { t } = useTranslation("settings");
  const reset = useSettings((s) => s.reset);
  const { setTheme } = useTheme();
  const info = useQuery({
    queryKey: ["app-info"],
    queryFn: () => commands.appInfo(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <>
      <SettingsSection title={t("about.title")}>
        <div className="flex items-center gap-3 px-4 py-3">
          <OdinAppIcon className="size-11 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold text-sm">odin-db</span>
            <span className="text-muted-foreground text-xs">{t("about.tagline")}</span>
          </div>
          <span className="ml-auto font-mono text-muted-foreground text-sm selectable">
            {info.data ? `v${info.data.version}` : "—"}
          </span>
        </div>
        <SettingRow label={t("about.platform")}>
          <span className="max-w-72 truncate font-mono text-muted-foreground text-xs selectable">
            {info.data
              ? `${info.data.os} ${info.data.arch} · Tauri ${info.data.tauriVersion} · WebView ${info.data.webviewVersion}`
              : "—"}
          </span>
        </SettingRow>
        <UpdateRow />
        <SettingRow label={t("about.license")}>
          <span className="text-muted-foreground text-sm">MIT OR Apache-2.0</span>
        </SettingRow>
        <SettingRow label={t("about.source")}>
          <span className="font-mono text-muted-foreground text-xs selectable">{REPOSITORY}</span>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t("reset.title")}>
        <SettingRow label={t("reset.label")} description={t("reset.hint")}>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                {t("reset.button")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("reset.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("reset.confirmDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    reset();
                    setTheme("system");
                    toast.success(t("reset.done"));
                  }}
                >
                  {t("reset.button")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingRow>
      </SettingsSection>
    </>
  );
}
