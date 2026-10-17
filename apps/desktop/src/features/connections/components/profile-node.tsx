import type { ConnectionProfile } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { Lock, MoreHorizontal, Pencil, Plug, Trash2, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorMessage } from "@/lib/ipc";
import { useConnect, useDisconnect } from "../api/mutations";
import { useConnectionOf } from "../api/queries";
import { useExpanded } from "../store/explorer-store";
import { DatabaseList } from "./database-list";
import { TreeRow } from "./tree-row";

interface ProfileNodeProps {
  profile: ConnectionProfile;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileNode({ profile, onEdit, onDelete }: ProfileNodeProps) {
  const { t } = useTranslation("connections");
  const connection = useConnectionOf(profile.id);
  const connect = useConnect();
  const disconnect = useDisconnect();
  const [expanded, setExpanded] = useExpanded(profile.id);

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
          connection
            ? t("profile.connected", { version: connection.serverVersion })
            : profile.connectionString
        }
        icon={
          <span className="relative flex">
            <span
              className={cn(
                "size-2 rounded-full",
                connection ? "bg-success" : "border border-muted-foreground/50",
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={t("profile.actions", { name: profile.name })}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
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
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                {t("profile.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                {t("profile.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {connection && expanded && <DatabaseList connection={connection} />}
    </>
  );
}
