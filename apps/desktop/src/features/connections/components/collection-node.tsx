import type { CollectionInfo, ConnectionInfo } from "@odin-db/bindings";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@odin-db/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Files,
  Folder,
  GitCompareArrows,
  HardDriveDownload,
  PencilLine,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupDialog } from "@/features/backup";
import { ExportDialog, ImportDialog } from "@/features/transfer";
import { useTabs } from "@/features/workspace";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { formatCompact } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { isModClick } from "@/lib/shortcuts";
import { connectionKeys } from "../api/keys";
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

// Compass's vocabulary: a folder for collections.
const kindIcon = { collection: Folder, view: Eye, timeseries: Clock } as const;

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
  const copyKeys = useKeybindingLabel("copy");
  const { t, i18n: translation } = useTranslation("connections");
  const copyNode = useExplorer((s) => s.copy);
  const sizes = useSettings((s) => s.sidebarSizes);
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
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<
    "backup" | "compare" | "copy" | "rename" | "drop" | "export" | "import" | null
  >(null);
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
          favorite || collection.kind !== "collection" || (sizes && count !== undefined) ? (
            <span className="flex items-center gap-1.5">
              {collection.kind !== "collection" && t(`tree.${collection.kind}`)}
              {sizes && count !== undefined && collection.kind !== "view" && (
                // The tree row is named after the collection alone; the count is a hint.
                <span aria-hidden className="tabular-nums" title={t("tree.count", { count })}>
                  {formatCompact(count, translation.language)}
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
            <DropdownMenuItem onSelect={() => open(true)}>
              <ExternalLink />
              {t("tree.openInNewTab")}
            </DropdownMenuItem>
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
                {t("clipboard.copyCollection")}
                {copyKeys && <DropdownMenuShortcut>{copyKeys}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDialog("export")}>
              <Download />
              {t("menu.exportCollection", { ns: "transfer" })}
            </DropdownMenuItem>
            {writable && !isView && (
              <DropdownMenuItem onSelect={() => setDialog("import")}>
                <Upload />
                {t("menu.importCollection", { ns: "transfer" })}
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
      {dialog === "export" && (
        <ExportDialog
          connectionId={connection.id}
          namespace={{ database, collection: collection.name }}
          source={{
            kind: "find",
            request: {
              filter: {},
              projection: null,
              sort: null,
              skip: null,
              limit: null,
              batchSize: 1000,
            },
          }}
          columns={[]}
          whole
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          connectionId={connection.id}
          namespace={{ database, collection: collection.name }}
          // The tree's document counts are the one thing here that changes.
          onImported={() =>
            void queryClient.invalidateQueries({
              queryKey: connectionKeys.counts(connection.id, database),
            })
          }
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
