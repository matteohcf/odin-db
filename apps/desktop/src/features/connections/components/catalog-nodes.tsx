import type { CollectionInfo, ConnectionInfo, DatabaseInfo } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import {
  ClipboardCopy,
  Clock,
  Copy,
  Database,
  Eye,
  FileDown,
  FileUp,
  HardDriveDownload,
  HardDriveUpload,
  PencilLine,
  Plus,
  Star,
  StarOff,
  Table2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { CopyDialog, DatabaseExportDialog, DatabaseImportDialog } from "@/features/transfer";
import { useTabs } from "@/features/workspace";
import { formatBytes } from "@/lib/format";
import { connectionKeys } from "../api/keys";
import { useCollectionCounts, useCollections, useProfile } from "../api/queries";
import { useCopyTargets } from "../hooks/use-copy-targets";
import { isSystem, SYSTEM_DATABASES } from "../lib/tree-rows";
import { useExpanded, useTreeFilter } from "../store/explorer-store";
import { useFavorites, useIsFavorite } from "../store/favorites-store";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { DropDialog } from "./drop-dialog";
import { HighlightMatch } from "./highlight-match";
import { NodeMenu } from "./node-menu";
import { RenameCollectionDialog } from "./rename-collection-dialog";
import { TreeRow } from "./tree-row";

/** A database row; its collections are rows of their own, after it. */
export function DatabaseNode({
  indent,
  connection,
  database,
  open,
  loading,
}: {
  indent: number;
  connection: ConnectionInfo;
  database: DatabaseInfo;
  open: boolean;
  loading: boolean;
}) {
  const { t } = useTranslation("connections");
  const [expanded, setExpanded] = useExpanded(`${connection.profileId}/${database.name}`);
  const [toolDialog, setToolDialog] = useState<
    "backup" | "restore" | "export" | "import" | "copy" | "createCollection" | "drop" | null
  >(null);
  const filter = useTreeFilter();
  // The export dialog lists the collections even when the database is collapsed.
  const collections = useCollections(connection.id, database.name, toolDialog === "export");
  const profileName = useProfile(connection.profileId)?.name ?? "";
  const queryClient = useQueryClient();
  const writable = !connection.readOnly;

  return (
    <>
      <TreeRow
        depth={1 + indent}
        expanded={open}
        loading={loading}
        onActivate={() => setExpanded(!expanded)}
        icon={<Database className="size-3.5" />}
        label={<HighlightMatch text={database.name} query={filter} />}
        trailing={database.empty ? undefined : formatBytes(database.sizeOnDisk ?? 0)}
        actions={
          <NodeMenu label={t("tree.actions", { name: database.name })}>
            {writable && (
              <>
                <DropdownMenuItem onSelect={() => setToolDialog("createCollection")}>
                  <Plus />
                  {t("catalog.createCollection")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => copyName(database.name)}>
              <ClipboardCopy />
              {t("tree.copyName")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setToolDialog("backup")}>
              <HardDriveDownload />
              {t("menu.backup", { ns: "backup" })}
            </DropdownMenuItem>
            {writable && (
              <DropdownMenuItem onSelect={() => setToolDialog("restore")}>
                <HardDriveUpload />
                {t("menu.restore", { ns: "backup" })}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setToolDialog("export")}>
              <FileDown />
              {t("database.menuExport", { ns: "transfer" })}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setToolDialog("copy")}>
              <Copy />
              {t("copy.menuDatabase", { ns: "transfer" })}
            </DropdownMenuItem>
            {writable && (
              <>
                <DropdownMenuItem onSelect={() => setToolDialog("import")}>
                  <FileUp />
                  {t("database.menuImport", { ns: "transfer" })}
                </DropdownMenuItem>
                {!SYSTEM_DATABASES.has(database.name) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setToolDialog("drop")}>
                      <Trash2 />
                      {t("catalog.dropDatabase")}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            )}
          </NodeMenu>
        }
      />
      {toolDialog === "createCollection" && (
        <CreateCollectionDialog
          connection={connection}
          database={database.name}
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "drop" && (
        <DropDialog
          connection={connection}
          target={{ kind: "database", database: database.name }}
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "backup" && (
        <BackupDialog
          connectionId={connection.id}
          profileName={profileName}
          scope={{ kind: "database", database: database.name }}
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "export" && (
        <DatabaseExportDialog
          connectionId={connection.id}
          database={database.name}
          collections={collections.data
            ?.filter((collection) => collection.kind !== "view" && !isSystem(collection))
            .map((collection) => collection.name)}
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "copy" && (
        <CopyDialogFor
          connection={connection}
          database={database.name}
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "import" && (
        <DatabaseImportDialog
          connectionId={connection.id}
          database={database.name}
          onImported={() =>
            void queryClient.invalidateQueries({
              queryKey: connectionKeys.connection(connection.id),
            })
          }
          onClose={() => setToolDialog(null)}
        />
      )}
      {toolDialog === "restore" && (
        <RestoreDialog
          connectionId={connection.id}
          profileName={profileName}
          readOnly={connection.readOnly}
          database={database.name}
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
  const Icon = kindIcon[collection.kind];
  const [dialog, setDialog] = useState<"backup" | "copy" | "rename" | "drop" | null>(null);
  const profileName = useProfile(connection.profileId)?.name ?? "";
  const isView = collection.kind === "view";
  const writable = !connection.readOnly && !isSystem(collection);

  return (
    <>
      <TreeRow
        depth={2 + indent}
        onActivate={() =>
          openCollection({
            profileId: connection.profileId,
            database,
            collection: collection.name,
            collectionKind: collection.kind,
          })
        }
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
        actions={
          <NodeMenu label={t("tree.actions", { name: collection.name })}>
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
          </NodeMenu>
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

function copyName(name: string) {
  void navigator.clipboard.writeText(name);
  toast.success(i18n.t("tree.nameCopied", { ns: "connections", name }));
}

/** The copy dialog with this app's connections as targets; refreshes the target's tree. */
function CopyDialogFor({
  connection,
  database,
  collection,
  onClose,
}: {
  connection: ConnectionInfo;
  database: string;
  collection?: string;
  onClose: () => void;
}) {
  const targets = useCopyTargets();
  const queryClient = useQueryClient();
  return (
    <CopyDialog
      sourceConnectionId={connection.id}
      database={database}
      collection={collection}
      targets={targets}
      onCopied={(target) =>
        void queryClient.invalidateQueries({ queryKey: connectionKeys.connection(target) })
      }
      onClose={onClose}
    />
  );
}
