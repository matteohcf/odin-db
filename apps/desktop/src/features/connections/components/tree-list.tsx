import type { ConnectionProfile } from "@odin-db/bindings";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTreeRows } from "../hooks/use-tree-rows";
import { collapsedGroupKey, type TreeItem } from "../lib/tree-rows";
import { useExplorer } from "../store/explorer-store";
import { CollectionNode, DatabaseNode } from "./catalog-nodes";
import { GroupNode } from "./group-node";
import { ProfileNode } from "./profile-node";
import { TreeMessage } from "./tree-row";

// h-7 rows plus the 1px gap between them.
const ROW_HEIGHT = 29;

interface TreeListProps {
  profiles: readonly ConnectionProfile[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onEdit: (profile: ConnectionProfile) => void;
  onDelete: (profile: ConnectionProfile) => void;
  onExport: (profile: ConnectionProfile) => void;
  onNewConnection: (group: string) => void;
}

/**
 * The connection tree as one flat, virtualized list: a cluster with hundreds of databases
 * and thousands of collections renders only the rows in view.
 */
export function TreeList({
  profiles,
  scrollRef,
  onEdit,
  onDelete,
  onExport,
  onNewConnection,
}: TreeListProps) {
  const rows = useTreeRows(profiles);
  const list = useRef<HTMLUListElement>(null);
  // Where the list starts in the scroller, below the favorites.
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const element = list.current;
    const scroller = scrollRef.current;
    if (!element || !scroller) return;
    const update = () => setOffset(element.offsetTop);
    update();
    const observer = new ResizeObserver(update);
    for (const child of scroller.children) if (child !== element) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollRef]);

  const revealing = useExplorer((s) => s.revealing);
  const revealed = useExplorer((s) => s.revealed);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.key ?? index,
    scrollMargin: offset,
    overscan: 16,
  });

  // Waits for the catalog to load: the row appears in a later render.
  const setExpanded = useExplorer((s) => s.setExpanded);
  useEffect(() => {
    if (!revealing) return;
    const index = rows.findIndex((row) => row.key === revealing);
    if (index < 0) {
      // The connection may sit in a collapsed group.
      const group = profiles.find((profile) => revealing.startsWith(`${profile.id}/`))?.group;
      if (group) setExpanded(collapsedGroupKey(group), false);
      return;
    }
    virtualizer.scrollToIndex(index, { align: "center" });
    revealed();
  }, [revealing, rows, virtualizer, revealed, profiles, setExpanded]);

  const { t } = useTranslation("connections");
  const filter = useExplorer((s) => s.filter.trim());

  return (
    <ul ref={list} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {rows.length === 0 && filter && (
        <li>
          <TreeMessage depth={0}>{t("explorer.noMatch", { filter })}</TreeMessage>
        </li>
      )}
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <li
            key={item.key}
            className="absolute inset-x-0 top-0"
            style={{ height: ROW_HEIGHT, transform: `translateY(${item.start - offset}px)` }}
          >
            <Row
              row={row}
              onEdit={onEdit}
              onDelete={onDelete}
              onExport={onExport}
              onNewConnection={onNewConnection}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Row({
  row,
  onEdit,
  onDelete,
  onExport,
  onNewConnection,
}: { row: TreeItem } & Omit<TreeListProps, "profiles" | "scrollRef">) {
  const { t } = useTranslation("connections");
  switch (row.kind) {
    case "group":
      return (
        <GroupNode
          name={row.name}
          count={row.count}
          collapsed={row.collapsed}
          onNewConnection={onNewConnection}
        />
      );
    case "profile":
      return (
        <ProfileNode
          indent={row.indent}
          profile={row.profile}
          onEdit={() => onEdit(row.profile)}
          onDelete={() => onDelete(row.profile)}
          onExport={() => onExport(row.profile)}
        />
      );
    case "database":
      return (
        <DatabaseNode
          indent={row.indent}
          connection={row.connection}
          database={row.database}
          open={row.open}
          loading={row.loading}
        />
      );
    case "collection":
      return (
        <CollectionNode
          indent={row.indent}
          connection={row.connection}
          database={row.database}
          collection={row.collection}
        />
      );
    case "message": {
      const { message } = row;
      return (
        <TreeMessage depth={row.depth}>
          {message.type === "failed"
            ? t("tree.failed", { message: message.error })
            : t(`tree.${message.type}`)}
        </TreeMessage>
      );
    }
  }
}
