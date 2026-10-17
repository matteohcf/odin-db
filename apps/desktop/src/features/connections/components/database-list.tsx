import type { CollectionInfo, ConnectionInfo, DatabaseInfo } from "@odin-db/bindings";
import { Clock, Database, Eye, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";
import { formatBytes } from "@/lib/format";
import { useCollections, useDatabases } from "../api/queries";
import { useExpanded } from "../store/explorer-store";
import { TreeMessage, TreeRow } from "./tree-row";

export function DatabaseList({ connection }: { connection: ConnectionInfo }) {
  const { t } = useTranslation("connections");
  const { data, error, isPending } = useDatabases(connection.id);

  if (isPending) return <TreeMessage depth={1}>{t("tree.loading")}</TreeMessage>;
  if (error) {
    return <TreeMessage depth={1}>{t("tree.failed", { message: error.message })}</TreeMessage>;
  }
  if (data.length === 0) return <TreeMessage depth={1}>{t("tree.noDatabases")}</TreeMessage>;

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
  const collections = useCollections(connection.id, database.name, expanded);

  return (
    <>
      <TreeRow
        depth={1}
        expanded={expanded}
        loading={expanded && collections.isPending}
        onActivate={() => setExpanded(!expanded)}
        icon={<Database className="size-3.5" />}
        label={database.name}
        trailing={database.empty ? undefined : formatBytes(database.sizeOnDisk ?? 0)}
      />
      {expanded &&
        (collections.error ? (
          <TreeMessage depth={2}>
            {t("tree.failed", { message: collections.error.message })}
          </TreeMessage>
        ) : collections.data?.length === 0 ? (
          <TreeMessage depth={2}>{t("tree.noCollections")}</TreeMessage>
        ) : (
          <ul className="flex flex-col gap-px">
            {sortSystemLast(collections.data ?? []).map((collection) => (
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
  const openCollection = useTabs((s) => s.openCollection);
  const Icon = kindIcon[collection.kind];

  return (
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
      label={collection.name}
      muted={isSystem(collection)}
      trailing={collection.kind === "collection" ? undefined : t(`tree.${collection.kind}`)}
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
