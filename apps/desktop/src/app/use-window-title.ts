import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useProfiles } from "@/features/connections";
import { useTabs } from "@/features/workspace";

/** The window says what it shows, for the app switcher and the Window menu. */
export function useWindowTitle() {
  const { t } = useTranslation("workspace");
  const tab = useTabs((s) => s.tabs.find((candidate) => candidate.id === s.activeTabId));
  const { data: profiles } = useProfiles();
  const profile =
    tab && "profileId" in tab ? profiles?.find((p) => p.id === tab.profileId) : undefined;
  const subject = !tab
    ? null
    : tab.kind === "collection"
      ? `${tab.database}.${tab.collection}`
      : tab.kind === "diagram"
        ? t("tabs.diagram", { database: tab.database })
        : t(`tabs.${tab.kind}`);
  const title = [subject, profile?.name, "odin-db"].filter(Boolean).join(" — ");

  useEffect(() => {
    document.title = title;
    if (isTauri()) void getCurrentWindow().setTitle(title);
  }, [title]);
}
