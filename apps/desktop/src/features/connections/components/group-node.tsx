import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { Folder, FolderInput, FolderOpen, PencilLine, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetGroup } from "../api/mutations";
import { useProfiles } from "../api/queries";
import { collapsedGroupKey } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { NodeMenu } from "./node-menu";
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
  const setGroup = useSetGroup();
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
        trailing={count}
        actions={
          <NodeMenu label={t("group.actions", { name })}>
            <DropdownMenuItem onSelect={() => onNewConnection(name)}>
              <Plus />
              {t("group.newConnection")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <PencilLine />
              {t("group.rename")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGroup.mutate({ profiles: members, group: null })}>
              <FolderInput />
              {t("group.ungroup")}
            </DropdownMenuItem>
          </NodeMenu>
        }
      />
      {renaming && (
        <RenameGroupDialog group={name} members={members} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}
