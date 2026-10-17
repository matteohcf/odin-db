import type { CollectionInfo, ConnectionInfo, DatabaseInfo } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
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
  Table2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { CopyDialog, DatabaseExportDialog, DatabaseImportDialog } from "@/features/transfer";
import { useTabs } from "@/features/workspace";
import { formatBytes } from "@/lib/format";
import { connectionKeys } from "../api/keys";
import { useCollections, useDatabases, useProfile } from "../api/queries";
import { useCopyTargets } from "../hooks/use-copy-targets";
import { useExpanded, useTreeFilter } from "../store/explorer-store";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { DropDialog } from "./drop-dialog";
import { HighlightMatch } from "./highlight-match";
import { NodeMenu } from "./node-menu";
import { RenameCollectionDialog } from "./rename-collection-dialog";
import { TreeMessage, TreeRow } from "./tree-row";

export function DatabaseList({ connection }: { connection: ConnectionInfo }) {
  const { t } = useTranslation("connections");
  const { data, error, isPending } = useDatabases(connection.id);
  const filter = useTreeFilter();

  if (isPending) return <TreeMessage depth={1}>{t("tree.loading")}</TreeMessage>;
  if (error) {
    return <TreeMessage depth={1}>{t("tree.failed", { message: error.message })}</TreeMessage>;
  }
  if (data.length === 0) return <TreeMessage depth={1}>{t("tree.noDatabases")}</TreeMessage>;
  if (filter && data.every((database) => SYSTEM_DATABASES.has(database.name))) return null;

  return (
    <ul className="flex flex-col gap-px">
      {data.map((database) => (
        <li key={database.name}>
          <DatabaseNode connection={connection} database={database} />
        </li>
      ))}
    </ul>
  );
}

function DatabaseNode({
  connection,
  database,
}: {
  connection: ConnectionInfo;
  database: DatabaseInfo;
}) {
  const { t } = useTranslation("connections");
  const [expanded, setExpanded] = useExpanded(`${connection.profileId}/${database.name}`);
  const [toolDialog, setToolDialog] = useState<
    "backup" | "restore" | "export" | "import" | "copy" | "createCollection" | "drop" | null
  >(null);
  const filter = useTreeFilter();
  const nameMatches = filter !== "" && database.name.toLowerCase().includes(filter);
  const collections = useCollections(
    connection.id,
    database.name,
    expanded || toolDialog === "export" || filter !== "",
  );
  // A matching database shows all its collections; otherwise only matching ones.
  const shownCollections =
    filter && !nameMatches
      ? collections.data?.filter((collection) => collection.name.toLowerCase().includes(filter))
      : collections.data;
  const open = filter && !nameMatches ? true : expanded;
  const profileName = useProfile(connection.profileId)?.name ?? "";
  const queryClient = useQueryClient();
  const writable = !connection.readOnly;

  if (filter && !nameMatches && !shownCollections?.length && toolDialog === null) return null;

  return (
    <>
      <TreeRow
        depth={1}
        expanded={open}
        loading={open && collections.isPending}
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
      {open &&
        (collections.error ? (
          <TreeMessage depth={2}>
            {t("tree.failed", { message: collections.error.message })}
          </TreeMessage>
        ) : collections.data?.length === 0 ? (
          <TreeMessage depth={2}>{t("tree.noCollections")}</TreeMessage>
        ) : (
          <ul className="flex flex-col gap-px">
            {sortSystemLast(shownCollections ?? []).map((collection) => (
              <li key={collection.name}>
                <CollectionNode
                  connection={connection}
                  database={database.name}
                  collection={collection}
                />
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

const kindIcon = { collection: Table2, view: Eye, timeseries: Clock } as const;

function CollectionNode({
  connection,
  database,
  collection,
}: {
  connection: ConnectionInfo;
  database: string;
  collection: CollectionInfo;
}) {
  const { t } = useTranslation("connections");
  const filter = useTreeFilter();
  const openCollection = useTabs((s) => s.openCollection);
  const Icon = kindIcon[collection.kind];
  const [dialog, setDialog] = useState<"backup" | "copy" | "rename" | "drop" | null>(null);
  const profileName = useProfile(connection.profileId)?.name ?? "";
  const isView = collection.kind === "view";
  const writable = !connection.readOnly && !isSystem(collection);

  return (
    <>
      <TreeRow
        depth={2}
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
        trailing={collection.kind === "collection" ? undefined : t(`tree.${collection.kind}`)}
        actions={
          isView && !writable ? undefined : (
            <NodeMenu label={t("tree.actions", { name: collection.name })}>
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
          )
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

/** Databases MongoDB manages itself; core refuses to drop them too. */
const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

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

function isSystem(collection: CollectionInfo) {
  return collection.name.startsWith("system.");
}

/** Internal `system.*` collections stay visible but out of the way. */
function sortSystemLast(collections: CollectionInfo[]) {
  return [...collections].sort((a, b) => Number(isSystem(a)) - Number(isSystem(b)));
}
