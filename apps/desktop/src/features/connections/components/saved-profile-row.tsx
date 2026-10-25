import type { ConnectionProfile } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { Lock, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorMessage, hostKeyError } from "@/lib/ipc";
import { useConnect, useDisconnect } from "../api/mutations";
import { useConnectionOf } from "../api/queries";
import { parseConnectionString } from "../lib/connection-uri";
import { useExplorer } from "../store/explorer-store";
import { ProfileMenuItems } from "./profile-menu-items";
import { TreeRow } from "./tree-row";

interface SavedProfileRowProps {
  indent: number;
  profile: ConnectionProfile;
  /** Connected, or already was: the manager closes and the sidebar shows it. */
  onOpened: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
}

/** A saved connection in the connection manager; a click connects it (ADR-0058). */
export function SavedProfileRow({
  indent,
  profile,
  onOpened,
  onEdit,
  onDelete,
  onExport,
}: SavedProfileRowProps) {
  const { t } = useTranslation("connections");
  const connection = useConnectionOf(profile.id);
  const connect = useConnect();
  const disconnect = useDisconnect();
  const setExpanded = useExplorer((s) => s.setExpanded);
  // Hosts without credentials or options: enough to tell two profiles apart.
  const hosts = parseConnectionString(profile.connectionString)?.hosts;

  function open() {
    if (connect.isPending) return;
    if (connection) {
      setExpanded(profile.id, true);
      onOpened();
      return;
    }
    connect.mutate(profile.id, {
      onSuccess: () => {
        setExpanded(profile.id, true);
        onOpened();
      },
      onError: (error) => {
        // Host keys get their own dialog, opened by `useConnect`.
        if (hostKeyError(error)) return;
        toast.error(t("profile.connectFailed", { name: profile.name }), {
          description: errorMessage(error),
        });
      },
    });
  }

  return (
    <TreeRow
      depth={indent}
      loading={connect.isPending}
      onActivate={open}
      title={connection ? t("manager.connected") : profile.connectionString}
      icon={
        <span
          className={cn(
            "size-2 rounded-full",
            connection ? "bg-success" : "border border-muted-foreground/50",
          )}
        />
      }
      label={
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium">{profile.name}</span>
          {hosts && <span className="truncate text-muted-foreground text-xs">{hosts}</span>}
          {connection && <span className="sr-only">{t("manager.connected")}</span>}
        </span>
      }
      trailing={
        profile.readOnly ? (
          <Lock className="size-3" aria-label={t("profile.readOnly")} />
        ) : undefined
      }
      menuLabel={t("profile.actions", { name: profile.name })}
      menu={
        <>
          {connection && (
            <>
              <DropdownMenuItem onSelect={() => disconnect.mutate(connection.id)}>
                <Unplug />
                {t("profile.disconnect")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <ProfileMenuItems
            profile={profile}
            onEdit={onEdit}
            onDelete={onDelete}
            onExport={onExport}
          />
        </>
      }
    />
  );
}
