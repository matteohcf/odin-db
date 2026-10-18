import type { BackupRun, ConnectionInfo, ConnectionProfile, ProfileId } from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RestoreDialog } from "@/features/backup";
import { useConnections, useProfiles } from "@/features/connections";
import { call, errorMessage } from "@/lib/ipc";

const NO_PROFILES: ConnectionProfile[] = [];
const NO_CONNECTIONS: ConnectionInfo[] = [];

/** Restores a history backup into its own connection, or another connected one. */
export function RestoreFromBackup({ run, onClose }: { run: BackupRun; onClose: () => void }) {
  const { t } = useTranslation("backups");
  const queryClient = useQueryClient();
  const profiles = useProfiles().data ?? NO_PROFILES;
  const connections = useConnections().data ?? NO_CONNECTIONS;
  const writable = connections.filter((connection) => !connection.readOnly);
  const [target, setTarget] = useState<ConnectionInfo | null>(null);
  const [source, setSource] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: ProfileId) => profiles.find((p) => p.id === id)?.name ?? "";

  async function start(connection: ConnectionInfo) {
    try {
      setSource(await call(commands.restoreSourceFromBackup(run.id)));
      setTarget(connection);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (target && source) {
    return (
      <RestoreDialog
        connectionId={target.id}
        profileName={nameOf(target.profileId)}
        readOnly={target.readOnly}
        database={run.scope.kind === "deployment" ? undefined : run.scope.database}
        initialSource={source}
        onRestored={() =>
          void queryClient.invalidateQueries({ queryKey: ["connections", target.id] })
        }
        onClose={onClose}
      />
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("restore.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {writable.length === 0 ? t("restore.noConnection") : t("restore.choose")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1">
          {writable.map((connection) => (
            <li key={connection.id}>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => void start(connection)}
              >
                {nameOf(connection.profileId)}
                {connection.profileId === run.profileId && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {t("restore.original")}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
