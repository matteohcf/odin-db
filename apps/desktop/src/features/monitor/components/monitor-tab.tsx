import { Button } from "@odin-db/ui/components/button";
import { Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnectionOf, useProfile } from "@/features/connections";
import { type ServerTab, useTabs } from "@/features/workspace";
import { MonitorView } from "./monitor-view";

/** A server monitor tab: binds to the profile's connection, polling only while visible. */
export function MonitorTab({ tab }: { tab: ServerTab }) {
  const { t } = useTranslation("monitor");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();
  const active = useTabs((s) => s.activeTabId === tab.id);

  if (connection && profile) {
    return <MonitorView connection={connection} profileName={profile.name} active={active} />;
  }
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
