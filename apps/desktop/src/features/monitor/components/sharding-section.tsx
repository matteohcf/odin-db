import { type ConnectionInfo, commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { compactEJson } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";

interface ShardingSectionProps {
  connection: ConnectionInfo;
  polling: number | false;
}

/** Shards, balancer and sharded collections of a cluster; nothing unless connected to a mongos. */
export function ShardingSection({ connection, polling }: ShardingSectionProps) {
  const { t } = useTranslation("monitor");
  const status = useQuery({
    queryKey: ["sharding-status", connection.id],
    queryFn: () => call(commands.shardingStatus(connection.id)),
    // Shards change rarely: a slower pace than the live counters.
    refetchInterval: polling === false ? false : Math.max(polling, 10_000),
  });
  if (status.data === null || status.isPending) return null;

  return (
    <section className="mt-6 flex flex-col gap-2" aria-label={t("sharding.title")}>
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-sm">{t("sharding.title")}</h2>
        {status.data && (
          <Badge
            variant={status.data.balancerMode === "off" ? "outline" : "secondary"}
            className={status.data.balancerMode === "off" ? "text-warning" : undefined}
          >
            {status.data.balancerRunning
              ? t("sharding.balancing")
              : t(`sharding.balancer.${status.data.balancerMode}` as "sharding.balancer.full", {
                  defaultValue: status.data.balancerMode,
                })}
          </Badge>
        )}
      </div>
      {status.error ? (
        <p role="alert" className="text-destructive text-xs selectable">
          {t("sharding.failed", { message: errorMessage(status.error) })}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full table-fixed text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="w-32 px-3 py-2 font-medium">
                    {t("sharding.shards", { count: status.data.shards.length })}
                  </th>
                  <th className="px-3 py-2 font-medium">{t("sharding.hosts")}</th>
                </tr>
              </thead>
              <tbody>
                {status.data.shards.map((shard) => (
                  <tr key={shard.id} className="border-t align-top">
                    <td className="px-3 py-2 font-mono">
                      {shard.id}
                      {shard.draining && (
                        <span className="ml-1.5 font-sans text-warning">
                          {t("sharding.draining")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground [overflow-wrap:anywhere]">
                      {shard.host}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full table-fixed text-xs">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    {t("sharding.collections", { count: status.data.collections.length })}
                  </th>
                  <th className="w-1/2 px-3 py-2 font-medium">{t("sharding.key")}</th>
                </tr>
              </thead>
              <tbody>
                {status.data.collections.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                      {t("sharding.noCollections")}
                    </td>
                  </tr>
                ) : (
                  status.data.collections.map((collection) => (
                    <tr key={collection.namespace} className="border-t">
                      <td className="truncate px-3 py-2 font-mono" title={collection.namespace}>
                        {collection.namespace}
                      </td>
                      <td className="truncate px-3 py-2 font-mono text-muted-foreground">
                        {compactEJson(collection.key).text}
                        {collection.unique && (
                          <span className="ml-1.5 font-sans">{t("sharding.unique")}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
