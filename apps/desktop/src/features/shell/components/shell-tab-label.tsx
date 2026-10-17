import { SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProfile } from "@/features/connections";
import type { ShellTab } from "@/features/workspace";

export function ShellTabLabel({ tab }: { tab: ShellTab }) {
  const { t } = useTranslation("shell");
  const profile = useProfile(tab.profileId);
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={profile?.name}>
      <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0">{t("tab.title")}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">{profile?.name}</span>
    </span>
  );
}
