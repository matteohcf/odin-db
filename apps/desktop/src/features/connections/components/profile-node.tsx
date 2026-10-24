import type { ConnectionProfile } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  CopyPlus,
  DatabaseZap,
  FileDown,
  HardDriveDownload,
  HardDriveUpload,
  Link,
  Lock,
  Pencil,
  Plug,
  RefreshCw,
  SquareTerminal,
  TextSearch,
  Trash2,
  Unplug,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { useTabs } from "@/features/workspace";
import { errorMessage, hostKeyError } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { connectionKeys } from "../api/keys";
import { useConnect, useDisconnect, useDuplicateProfile } from "../api/mutations";
import { databasesQuery, useConnectionOf } from "../api/queries";
import { useExpanded } from "../store/explorer-store";
import { useConnectionHealth } from "../store/health-store";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { TreeRow } from "./tree-row";
import { ValueSearchDialog } from "./value-search-dialog";

interface ProfileNodeProps {
  /** Levels added by an enclosing group. */
  indent: number;
  profile: ConnectionProfile;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}

export function ProfileNode({ indent, profile, onEdit, onDelete, onExport }: ProfileNodeProps) {
  const { t } = useTranslation("connections");
  const connection = useConnectionOf(profile.id);
  const unreachable = useConnectionHealth((s) =>
    connection ? s.unreachable[connection.id] === true : false,
  );
  const connect = useConnect();
  const disconnect = useDisconnect();
  const duplicate = useDuplicateProfile();
  const [expanded, setExpanded] = useExpanded(profile.id);
  const sizes = useSettings((s) => s.sidebarSizes);
  // The same query as the tree, so it is shared once the connection is expanded.
  const databaseCount = useQuery({
    ...databasesQuery(connection?.id ?? ""),
    enabled: connection !== undefined,
  }).data?.length;
  const [toolDialog, setToolDialog] = useState<
    "backup" | "restore" | "createDatabase" | "search" | null
  >(null);
  const queryClient = useQueryClient();
  const openShell = useTabs((s) => s.openShell);
  const openServer = useTabs((s) => s.openServer);
  const openUsers = useTabs((s) => s.openUsers);
  const openBackups = useTabs((s) => s.openBackups);

  function open() {
    if (connect.isPending) return;
    if (connection) {
      setExpanded(!expanded);
      return;
    }
    connect.mutate(profile.id, {
      onSuccess: () => setExpanded(true),
      onError: (error) => {
        // Host keys get their own dialog, opened by `useConnect`.
        if (hostKeyError(error)) return;
        toast.error(t("profile.connectFailed", { name: profile.name }), {
          description: errorMessage(error),
        });
      },
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
        depth={indent}
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
        label={<span className="truncate font-medium">{profile.name}</span>}
        trailing={
          (sizes && databaseCount !== undefined) || profile.readOnly ? (
            <span className="flex items-center gap-1.5">
              {sizes && databaseCount !== undefined && (
                // The row is named after the connection alone; the count is a hint.
                <span
                  aria-hidden
                  className="tabular-nums"
                  title={t("tree.databases", { count: databaseCount })}
                >
                  {databaseCount}
                </span>
              )}
              {profile.readOnly && <Lock className="size-3" aria-label={t("profile.readOnly")} />}
            </span>
          ) : undefined
        }
        menuLabel={t("profile.actions", { name: profile.name })}
        menu={
          <>
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
                <DropdownMenuSeparator />
                {!connection.readOnly && (
                  <DropdownMenuItem onSelect={() => setToolDialog("createDatabase")}>
                    <DatabaseZap />
                    {t("profile.createDatabase")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setToolDialog("search")}>
                  <TextSearch />
                  {t("search.menu")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openUsers(profile.id)}>
                  <UsersRound />
                  {t("profile.users")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openServer(profile.id)}>
                  <Activity />
                  {t("profile.serverStatus")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openShell(profile.id)}>
                  <SquareTerminal />
                  {t("profile.openShell")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setToolDialog("backup")}>
                  <HardDriveDownload />
                  {t("menu.backupAll", { ns: "backup" })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openBackups}>
                  <CalendarClock />
                  {t("profile.backups")}
                </DropdownMenuItem>
                {!connection.readOnly && (
                  <DropdownMenuItem onSelect={() => setToolDialog("restore")}>
                    <HardDriveUpload />
                    {t("menu.restore", { ns: "backup" })}
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              {t("profile.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                duplicate.mutate(
                  { id: profile.id, name: t("profile.copyName", { name: profile.name }) },
                  {
                    onSuccess: (copy) =>
                      toast.success(t("profile.duplicated", { name: copy.name })),
                  },
                )
              }
            >
              <CopyPlus />
              {t("profile.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(profile.connectionString);
                toast.success(t("profile.uriCopied"));
              }}
            >
              <Link />
              {t("profile.copyUri")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport}>
              <FileDown />
              {t("profile.export")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t("profile.delete")}
            </DropdownMenuItem>
          </>
        }
      />
      {connection && toolDialog === "search" && (
        <ValueSearchDialog connection={connection} onClose={() => setToolDialog(null)} />
      )}
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
