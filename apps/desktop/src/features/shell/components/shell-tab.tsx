import { Button } from "@odin-db/ui/components/button";
import { Loader2, ShieldAlert, SquareTerminal, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnectionOf, useProfile } from "@/features/connections";
import type { ShellTab as ShellTabModel } from "@/features/workspace";
import { useMongoshStatus } from "../api/use-mongosh-status";
import { MongoshDownload } from "./mongosh-download";
import { TerminalView } from "./terminal-view";

const DOWNLOAD_URL = "https://www.mongodb.com/try/download/shell";

/** A shell tab: checks mongosh and the connection, then hosts the terminal. */
export function ShellTab({ tab }: { tab: ShellTabModel }) {
  const { t } = useTranslation("shell");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();
  const mongosh = useMongoshStatus();

  if (mongosh.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (!mongosh.data?.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <SquareTerminal className="size-6 text-muted-foreground" />
        <div className="flex max-w-md flex-col gap-1.5">
          <p className="font-medium">{t("missing.title")}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">{t("missing.body")}</p>
        </div>
        {mongosh.data?.downloadVersion && (
          <MongoshDownload version={mongosh.data.downloadVersion} />
        )}
        <p className="font-mono text-[11px] text-muted-foreground selectable">
          {t("missing.manual", { url: DOWNLOAD_URL })}
        </p>
      </div>
    );
  }
  if (!connection || !profile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Unplug className="size-5 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("disconnected.title", { name: profile?.name ?? "" })}</p>
          <p className="text-muted-foreground text-xs">{t("disconnected.body")}</p>
        </div>
        <Button
          size="sm"
          onClick={() => connect.mutate(tab.profileId)}
          disabled={connect.isPending}
        >
          {t("disconnected.connect")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {connection.readOnly && (
        <p className="flex shrink-0 items-start gap-2 border-b bg-warning/5 px-3 py-2 text-warning text-xs">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          {t("readOnly", { name: profile.name })}
        </p>
      )}
      {/* Keyed by connection: a reconnect starts a fresh session. */}
      <TerminalView key={connection.id} connectionId={connection.id} />
    </div>
  );
}
