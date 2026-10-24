import type { CollectionInfo, ConnectionInfo } from "@odin-db/bindings";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@odin-db/ui/components/dropdown-menu";
import {
  ClipboardCopy,
  Clock,
  Copy,
  Eye,
  Files,
  GitCompareArrows,
  HardDriveDownload,
  PencilLine,
  Star,
  StarOff,
  Table2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupDialog } from "@/features/backup";
import { useTabs } from "@/features/workspace";
import { EDIT_SHORTCUTS, isModClick, label } from "@/lib/shortcuts";
import { useCollectionCounts, useProfile } from "../api/queries";
import { copyName } from "../lib/copy-name";
import { isSystem } from "../lib/tree-rows";
import { useExplorer, useTreeFilter } from "../store/explorer-store";
import { useFavorites, useIsFavorite } from "../store/favorites-store";
import { CompareDialogFor } from "./compare-dialog-for";
import { CopyDialogFor } from "./copy-dialog-for";
import { DropDialog } from "./drop-dialog";
import { HighlightMatch } from "./highlight-match";
import { RenameCollectionDialog } from "./rename-collection-dialog";
import { TreeRow } from "./tree-row";

const kindIcon = { collection: Table2, view: Eye, timeseries: Clock } as const;

export function CollectionNode({
  indent,
  connection,
  database,
  collection,
}: {
  indent: number;
  connection: ConnectionInfo;
  database: string;
  collection: CollectionInfo;
}) {
  const { t, i18n: translation } = useTranslation("connections");
  const copyNode = useExplorer((s) => s.copy);
  const favorite = useIsFavorite(connection.profileId, database, collection.name);
  // One query per database, shared by its rows; absent for views and while loading.
  const count = useCollectionCounts(connection.id, database, true).data?.get(collection.name);
  const toggleFavorite = useFavorites((s) => s.toggle);
  const filter = useTreeFilter();
  const openCollection = useTabs((s) => s.openCollection);
  const active = useTabs((s) => {
    const tab = s.tabs.find((candidate) => candidate.id === s.activeTabId);
    return (
      tab?.kind === "collection" &&
      tab.profileId === connection.profileId &&
      tab.database === database &&
      tab.collection === collection.name
    );
  });
  // GridFS buckets keep their files' descriptions in `<bucket>.files`.
  const Icon = collection.name.endsWith(".files") ? Files : kindIcon[collection.kind];
  const open = (newTab: boolean) =>
    openCollection(
      {
        profileId: connection.profileId,
        database,
        collection: collection.name,
        collectionKind: collection.kind,
      },
      newTab,
    );
  const [dialog, setDialog] = useState<"backup" | "compare" | "copy" | "rename" | "drop" | null>(
    null,
  );
  const profileName = useProfile(connection.profileId)?.name ?? "";
  const isView = collection.kind === "view";
  const writable = !connection.readOnly && !isSystem(collection);

  return (
    <>
      <TreeRow
        depth={2 + indent}
        // Cmd/Ctrl-click or middle click opens another tab, like a browser link.
        onActivate={(event) => open(isModClick(event))}
        onAuxActivate={() => open(true)}
        icon={<Icon className="size-3.5" />}
        label={<HighlightMatch text={collection.name} query={filter} />}
        muted={isSystem(collection)}
        active={active}
        trailing={
          favorite || collection.kind !== "collection" || count !== undefined ? (
            <span className="flex items-center gap-1.5">
              {collection.kind !== "collection" && t(`tree.${collection.kind}`)}
              {count !== undefined && collection.kind !== "view" && (
                // The tree row is named after the collection alone; the count is a hint.
                <span aria-hidden className="tabular-nums" title={t("tree.count", { count })}>
                  {compactCount(count, translation.language)}
                </span>
              )}
              {favorite && (
                <Star
                  className="size-3 fill-current text-yellow-500"
                  aria-label={t("favorites.starred")}
                />
              )}
            </span>
          ) : undefined
        }
        menuLabel={t("tree.actions", { name: collection.name })}
        menu={
          <>
            <DropdownMenuItem
              onSelect={() =>
                toggleFavorite({
                  profileId: connection.profileId,
                  database,
                  collection: collection.name,
                  collectionKind: collection.kind,
                })
              }
            >
              {favorite ? <StarOff /> : <Star />}
              {favorite ? t("favorites.remove") : t("favorites.add")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyName(collection.name)}>
              <ClipboardCopy />
              {t("tree.copyName")}
            </DropdownMenuItem>
            {!isView && (
              <DropdownMenuItem
                onSelect={() => copyNode({ connection, database, collection: collection.name })}
              >
                <Copy />
                {t("clipboard.copy")}
                <DropdownMenuShortcut>{label(EDIT_SHORTCUTS.copy)}</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {writable && !isView && (
              <DropdownMenuItem onSelect={() => setDialog("rename")}>
                <PencilLine />
                {t("catalog.renameCollection")}
              </DropdownMenuItem>
            )}
            {!isView && (
              <>
                <DropdownMenuItem onSelect={() => setDialog("copy")}>
                  <Copy />
                  {t("copy.menuCollection", { ns: "transfer" })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("compare")}>
                  <GitCompareArrows />
                  {t("menu.compare", { ns: "compare" })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("backup")}>
                  <HardDriveDownload />
                  {t("menu.backup", { ns: "backup" })}
                </DropdownMenuItem>
              </>
            )}
            {writable && (
              <>
                {!isView && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog("drop")}>
                  <Trash2 />
                  {isView ? t("catalog.dropView") : t("catalog.dropCollection")}
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />
      {dialog === "backup" && (
        <BackupDialog
          connectionId={connection.id}
          profileName={profileName}
          scope={{ kind: "collection", database, collection: collection.name }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "compare" && (
        <CompareDialogFor
          connection={connection}
          database={database}
          collection={collection.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "copy" && (
        <CopyDialogFor
          connection={connection}
          database={database}
          collection={collection.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "rename" && (
        <RenameCollectionDialog
          connection={connection}
          database={database}
          collection={collection.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "drop" && (
        <DropDialog
          connection={connection}
          target={{
            kind: "collection",
            database,
            collection: collection.name,
            collectionKind: collection.kind,
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

/** 1.2K, 3.4M: short enough for the tree; the exact estimate is in the tooltip. */
function compactCount(count: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    count,
  );
}
