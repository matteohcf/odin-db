import type { ConnectionInfo, DatabaseInfo } from "@odin-db/bindings";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@odin-db/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Database,
  FileDown,
  FileUp,
  GitCompareArrows,
  HardDriveDownload,
  HardDriveUpload,
  Plus,
  TextSearch,
  Trash2,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BackupDialog, RestoreDialog } from "@/features/backup";
import { DatabaseExportDialog, DatabaseImportDialog } from "@/features/transfer";
import { useTabs } from "@/features/workspace";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { formatBytes } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { connectionKeys } from "../api/keys";
import { useCollections, useProfile } from "../api/queries";
import { copyName } from "../lib/copy-name";
import { isSystem, SYSTEM_DATABASES } from "../lib/tree-rows";
import { useExpanded, useExplorer, useTreeFilter } from "../store/explorer-store";
import { CompareSchemaDialogFor } from "./compare-schema-dialog-for";
import { CopyDialogFor } from "./copy-dialog-for";
import { CreateCollectionDialog } from "./create-collection-dialog";
import { DropDialog } from "./drop-dialog";
import { HighlightMatch } from "./highlight-match";
import { TreeRow } from "./tree-row";
import { ValueSearchDialog } from "./value-search-dialog";

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
  const copyKeys = useKeybindingLabel("copy");
  const pasteKeys = useKeybindingLabel("paste");
  const { t } = useTranslation("connections");
  const copyNode = useExplorer((s) => s.copy);
  const openDiagram = useTabs((s) => s.openDiagram);
  const sizes = useSettings((s) => s.sidebarSizes);
  const copied = useExplorer((s) => s.copied);
  const paste = useExplorer((s) => s.paste);
  const [expanded, setExpanded] = useExpanded(`${connection.profileId}/${database.name}`);
  const [toolDialog, setToolDialog] = useState<
    | "backup"
    | "restore"
    | "export"
    | "import"
    | "copy"
    | "compareSchema"
    | "createCollection"
    | "drop"
    | "search"
    | null
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
        trailing={sizes && !database.empty ? formatBytes(database.sizeOnDisk ?? 0) : undefined}
        menuLabel={t("tree.actions", { name: database.name })}
        menu={
          <>
            <DropdownMenuItem onSelect={() => openDiagram(connection.profileId, database.name)}>
              <Waypoints />
              {t("tree.diagram")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setToolDialog("search")}>
              <TextSearch />
              {t("search.menu")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
            <DropdownMenuItem onSelect={() => copyNode({ connection, database: database.name })}>
              <Copy />
              {t("clipboard.copyDatabase")}
              {copyKeys && <DropdownMenuShortcut>{copyKeys}</DropdownMenuShortcut>}
            </DropdownMenuItem>
            {copied && writable && (
              <DropdownMenuItem
                onSelect={() => paste({ connectionId: connection.id, database: database.name })}
              >
                <ClipboardPaste />
                {t("clipboard.paste", { name: copied.collection ?? copied.database })}
                {pasteKeys && <DropdownMenuShortcut>{pasteKeys}</DropdownMenuShortcut>}
              </DropdownMenuItem>
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
            <DropdownMenuItem onSelect={() => setToolDialog("compareSchema")}>
              <GitCompareArrows />
              {t("schema.menu", { ns: "compare" })}
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
          </>
        }
      />
      {toolDialog === "search" && (
        <ValueSearchDialog
          connection={connection}
          database={database.name}
          onClose={() => setToolDialog(null)}
        />
      )}
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
      {toolDialog === "compareSchema" && (
        <CompareSchemaDialogFor
          connection={connection}
          database={database.name}
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
