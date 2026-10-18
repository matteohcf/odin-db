import type { ConnectionInfo, DatabaseInfo } from "@odin-db/bindings";
import { DropdownMenuItem, DropdownMenuSeparator } from "@odin-db/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Copy,
  Database,
  FileDown,
  FileUp,
  HardDriveDownload,
  HardDriveUpload,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { DatabaseExportDialog, DatabaseImportDialog } from "@/features/transfer";
import { formatBytes } from "@/lib/format";
import { connectionKeys } from "../api/keys";
import { useCollections, useProfile } from "../api/queries";
import { copyName } from "../lib/copy-name";
import { isSystem, SYSTEM_DATABASES } from "../lib/tree-rows";
import { useExpanded, useTreeFilter } from "../store/explorer-store";
import { CopyDialogFor } from "./copy-dialog-for";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { DropDialog } from "./drop-dialog";
import { HighlightMatch } from "./highlight-match";
import { NodeMenu } from "./node-menu";
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
