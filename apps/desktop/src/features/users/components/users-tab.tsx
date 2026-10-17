import { Button } from "@odin-db/ui/components/button";
import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnectionOf, useProfile } from "@/features/connections";
import type { UsersTab as UsersTabModel } from "@/features/workspace";
import { UsersView } from "./users-view";

/** The users tab of a connection; offers to connect when it is closed. */
export function UsersTab({ tab }: { tab: UsersTabModel }) {
  const { t } = useTranslation("users");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();
  if (connection && profile)
    return <UsersView connection={connection} profileName={profile.name} />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Unplug className="size-5 text-muted-foreground" />
      <p className="font-medium">{t("disconnected", { name: profile?.name ?? "" })}</p>
      <Button size="sm" onClick={() => connect.mutate(tab.profileId)} disabled={connect.isPending}>
        {t("connect")}
      </Button>
    </div>
  );
}
