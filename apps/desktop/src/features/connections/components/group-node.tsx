import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { Folder, FolderInput, FolderOpen, PencilLine, Plus, Unplug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDisconnectAll, useSetGroup } from "../api/mutations";
import { useConnections, useProfiles } from "../api/queries";
import { collapsedGroupKey } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { RenameGroupDialog } from "./rename-group-dialog";
import { TreeRow } from "./tree-row";

/** A folder of connections, set by the "Group" field of each connection. */
export function GroupNode({
  name,
  count,
  collapsed,
  onNewConnection,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onNewConnection: (group: string) => void;
}) {
  const { t } = useTranslation("connections");
  const setExpanded = useExplorer((s) => s.setExpanded);
  const members = (useProfiles().data ?? []).filter((profile) => profile.group === name);
  const connections = useConnections().data ?? [];
  // Visible while collapsed: which folders hold open connections.
  const open = members.filter((profile) =>
    connections.some((connection) => connection.profileId === profile.id),
  ).length;
  const summary = [
    t("group.connections", { count }),
    ...(open > 0 ? [t("group.open", { count: open })] : []),
  ].join(" · ");
  const setGroup = useSetGroup();
  const disconnectAll = useDisconnectAll();
  const [renaming, setRenaming] = useState(false);
  const Icon = collapsed ? Folder : FolderOpen;
  return (
    <>
      <TreeRow
        depth={0}
        expanded={!collapsed}
        onActivate={() => setExpanded(collapsedGroupKey(name), !collapsed)}
        icon={<Icon className="size-3.5" />}
        label={<span className="font-medium">{name}</span>}
        trailing={
          // One number, the folder's size; a dot says some of them are connected.
          <span className="flex items-center gap-1.5" title={summary}>
            {open > 0 && <span aria-hidden className="size-1.5 rounded-full bg-success" />}
            <span aria-hidden className="tabular-nums">
              {count}
            </span>
            <span className="sr-only">{summary}</span>
          </span>
        }
        menuLabel={t("group.actions", { name })}
        menu={
          <>
            <DropdownMenuItem onSelect={() => onNewConnection(name)}>
              <Plus />
              {t("group.newConnection")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <PencilLine />
              {t("group.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={open === 0}
              onSelect={() =>
                disconnectAll.mutate(
                  connections
                    .filter((connection) => members.some((p) => p.id === connection.profileId))
                    .map((connection) => connection.id),
                )
              }
            >
              <Unplug />
              {t("group.disconnectAll")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGroup.mutate({ profiles: members, group: null })}>
              <FolderInput />
              {t("group.ungroup")}
            </DropdownMenuItem>
          </>
        }
      />
      {renaming && (
        <RenameGroupDialog group={name} members={members} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}
