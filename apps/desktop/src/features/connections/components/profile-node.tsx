import type { ConnectionProfile } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  DatabaseZap,
  HardDriveDownload,
  HardDriveUpload,
  Lock,
  Pencil,
  Plug,
  RefreshCw,
  SquareTerminal,
  Trash2,
  Unplug,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { useTabs } from "@/features/workspace";
import { errorMessage } from "@/lib/ipc";
import { connectionKeys } from "../api/keys";
import { useConnect, useDisconnect } from "../api/mutations";
import { useConnectionOf } from "../api/queries";
import { useExpanded } from "../store/explorer-store";
import { useConnectionHealth } from "../store/health-store";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { DatabaseList } from "./database-list";
import { NodeMenu } from "./node-menu";
import { TreeRow } from "./tree-row";

interface ProfileNodeProps {
  profile: ConnectionProfile;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileNode({ profile, onEdit, onDelete }: ProfileNodeProps) {
  const { t } = useTranslation("connections");
  const connection = useConnectionOf(profile.id);
  const unreachable = useConnectionHealth((s) =>
    connection ? s.unreachable[connection.id] === true : false,
  );
  const connect = useConnect();
  const disconnect = useDisconnect();
  const [expanded, setExpanded] = useExpanded(profile.id);
  const [toolDialog, setToolDialog] = useState<"backup" | "restore" | "createDatabase" | null>(
    null,
  );
  const queryClient = useQueryClient();
  const openShell = useTabs((s) => s.openShell);

  function open() {
    if (connection) {
      setExpanded(!expanded);
      return;
    }
    connect.mutate(profile.id, {
      onSuccess: () => setExpanded(true),
      onError: (error) =>
        toast.error(t("profile.connectFailed", { name: profile.name }), {
          description: errorMessage(error),
        }),
    });
  }

  function close() {
    if (!connection) return;
    setExpanded(false);
    disconnect.mutate(connection.id);
  }

  return (
    <>
      <TreeRow
        depth={0}
        expanded={connection ? expanded : false}
        loading={connect.isPending}
        onActivate={open}
        title={
          unreachable
            ? t("health.unreachable")
            : connection
              ? t("profile.connected", { version: connection.serverVersion })
              : profile.connectionString
        }
        icon={
          <span className="relative flex">
            {unreachable && <span className="sr-only">{t("health.unreachable")}</span>}
            <span
              className={cn(
                "size-2 rounded-full",
                unreachable
                  ? "animate-pulse bg-warning"
                  : connection
                    ? "bg-success"
                    : "border border-muted-foreground/50",
              )}
            />
          </span>
        }
        label={<span className="font-medium">{profile.name}</span>}
        trailing={
          profile.readOnly ? (
            <Lock className="size-3" aria-label={t("profile.readOnly")} />
          ) : undefined
        }
        actions={
          <NodeMenu label={t("profile.actions", { name: profile.name })}>
            {connection ? (
              <DropdownMenuItem onSelect={close}>
                <Unplug />
                {t("profile.disconnect")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={open}>
                <Plug />
                {t("profile.connect")}
              </DropdownMenuItem>
            )}
            {connection && (
              <>
                <DropdownMenuItem
                  onSelect={() =>
                    void queryClient.invalidateQueries({
                      queryKey: connectionKeys.connection(connection.id),
                    })
                  }
                >
                  <RefreshCw />
                  {t("profile.refresh")}
                </DropdownMenuItem>
                {!connection.readOnly && (
                  <DropdownMenuItem onSelect={() => setToolDialog("createDatabase")}>
                    <DatabaseZap />
                    {t("profile.createDatabase")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => openShell(profile.id)}>
                  <SquareTerminal />
                  {t("profile.openShell")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setToolDialog("backup")}>
                  <HardDriveDownload />
                  {t("menu.backupAll", { ns: "backup" })}
                </DropdownMenuItem>
                {!connection.readOnly && (
                  <DropdownMenuItem onSelect={() => setToolDialog("restore")}>
                    <HardDriveUpload />
                    {t("menu.restore", { ns: "backup" })}
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              {t("profile.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t("profile.delete")}
            </DropdownMenuItem>
          </NodeMenu>
        }
      />
      {connection && expanded && <DatabaseList connection={connection} />}
      {connection && toolDialog === "createDatabase" && (
        <CreateCollectionDialog connection={connection} onClose={() => setToolDialog(null)} />
      )}
      {connection && toolDialog === "backup" && (
        <BackupDialog
          connectionId={connection.id}
          profileName={profile.name}
          scope={{ kind: "deployment" }}
          onClose={() => setToolDialog(null)}
        />
      )}
      {connection && toolDialog === "restore" && (
        <RestoreDialog
          connectionId={connection.id}
          profileName={profile.name}
          readOnly={connection.readOnly}
          onRestored={() =>
            void queryClient.invalidateQueries({
              queryKey: connectionKeys.connection(connection.id),
            })
          }
          onClose={() => setToolDialog(null)}
        />
      )}
    </>
  );
}
