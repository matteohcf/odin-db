import { UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileColorMark } from "@/components/profile-color-mark";
import { useProfile } from "@/features/connections";
import type { UsersTab } from "@/features/workspace";

export function UsersTabLabel({ tab }: { tab: UsersTab }) {
  const { t } = useTranslation("users");
  const profile = useProfile(tab.profileId);
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={profile?.name}>
      <ProfileColorMark color={profile?.color} />
      <UsersRound className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0">{t("tab")}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">{profile?.name}</span>
    </span>
  );
}
