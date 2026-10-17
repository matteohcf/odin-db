import { Button } from "@odin-db/ui/components/button";
import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnectionOf, useProfile } from "@/features/connections";
import type { CollectionTab as CollectionTabModel } from "@/features/workspace";
import { CollectionView } from "./collection-view";

/** Entry point for a collection tab: binds it to its profile's live connection. */
export function CollectionTab({ tab }: { tab: CollectionTabModel }) {
  const { t } = useTranslation("documents");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();

  if (connection && profile) {
    return <CollectionView tab={tab} profileName={profile.name} connection={connection} />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Unplug className="size-5 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{t("disconnected.title", { name: profile?.name ?? "" })}</p>
        <p className="text-muted-foreground text-xs">
          {t("disconnected.body", { namespace: `${tab.database}.${tab.collection}` })}
        </p>
      </div>
      <Button size="sm" onClick={() => connect.mutate(tab.profileId)} disabled={connect.isPending}>
        {t("disconnected.connect")}
      </Button>
    </div>
  );
}
