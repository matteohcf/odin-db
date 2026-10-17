import type { ConnectionProfile } from "@odin-db/bindings";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { collectionsQuery, databasesQuery, useConnections } from "../api/queries";
import { buildTreeRows, listedConnections, listsCollections } from "../lib/tree-rows";
import { useExplorer, useTreeFilter } from "../store/explorer-store";

/** Every visible row of the connection tree, with the catalog queries it needs. */
export function useTreeRows(profiles: readonly ConnectionProfile[]) {
  const { data: connections } = useConnections();
  const expanded = useExplorer((s) => s.expanded);
  const filter = useTreeFilter();
  const connectionOf = (profile: ConnectionProfile) =>
    connections?.find((connection) => connection.profileId === profile.id);
  const base = { profiles, connectionOf, expanded, filter };

  const listed = listedConnections(base);
  const databases = useQueries({
    queries: listed.map((connection) => databasesQuery(connection.id)),
  });
  const databasesOf = new Map(listed.map((connection, i) => [connection.id, databases[i]]));

  const catalogs = listed.flatMap((connection) =>
    (databasesOf.get(connection.id)?.data ?? [])
      .filter((database) => listsCollections(base, connection, database.name))
      .map((database) => ({ connection, database: database.name })),
  );
  const collections = useQueries({
    queries: catalogs.map(({ connection, database }) => collectionsQuery(connection.id, database)),
  });
  const collectionsOf = new Map(
    catalogs.map(({ connection, database }, i) => [`${connection.id}/${database}`, collections[i]]),
  );

  // Queries return new arrays every render; their data only changes on fetch.
  const signature = [...databases, ...collections]
    .map((query) => `${query.status}${query.dataUpdatedAt}${query.errorUpdatedAt}`)
    .join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` stands for the query data.
  return useMemo(
    () =>
      buildTreeRows({
        ...base,
        databases: (connection) => {
          const query = databasesOf.get(connection.id);
          return { data: query?.data, error: query?.error ?? null };
        },
        collections: (connection, database) => {
          const query = collectionsOf.get(`${connection.id}/${database}`);
          return { data: query?.data, error: query?.error ?? null };
        },
      }),
    [profiles, connections, expanded, filter, signature],
  );
}
