import { Folder, FolderOpen } from "lucide-react";
import { collapsedGroupKey } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { TreeRow } from "./tree-row";

/** A folder of connections, set by the "Group" field of each connection. */
export function GroupNode({
  name,
  count,
  collapsed,
}: {
  name: string;
  count: number;
  collapsed: boolean;
}) {
  const setExpanded = useExplorer((s) => s.setExpanded);
  const Icon = collapsed ? Folder : FolderOpen;
  return (
    <TreeRow
      depth={0}
      expanded={!collapsed}
      onActivate={() => setExpanded(collapsedGroupKey(name), !collapsed)}
      icon={<Icon className="size-3.5" />}
      label={<span className="font-medium">{name}</span>}
      trailing={count}
    />
  );
}
