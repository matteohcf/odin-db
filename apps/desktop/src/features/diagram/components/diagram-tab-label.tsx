import { Waypoints } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileColorMark } from "@/components/profile-color-mark";
import { useProfile } from "@/features/connections";
import type { DiagramTab } from "@/features/workspace";

export function DiagramTabLabel({ tab }: { tab: DiagramTab }) {
  const { t } = useTranslation("diagram");
  const profile = useProfile(tab.profileId);
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      title={`${profile?.name ?? ""} / ${tab.database}`}
    >
      <ProfileColorMark color={profile?.color} />
      <Waypoints className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0">{tab.database}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">{t("tab")}</span>
    </span>
  );
}
