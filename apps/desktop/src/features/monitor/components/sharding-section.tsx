import { type ConnectionInfo, commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { compactEJson } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { pollUntilError } from "../lib/polling";
import { MonitorSection } from "./monitor-section";
import { PollError } from "./poll-error";

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
    refetchInterval: pollUntilError(polling === false ? false : Math.max(polling, 10_000)),
    retry: 1,
  });
  if (status.data === null || status.isPending) return null;

  return (
    <MonitorSection
      title={t("sharding.title")}
      detail={
        status.data && (
          <Badge variant={status.data.balancerMode === "off" ? "warning" : "secondary"}>
            {status.data.balancerRunning
              ? t("sharding.balancing")
              : t(`sharding.balancer.${status.data.balancerMode}` as "sharding.balancer.full", {
                  defaultValue: status.data.balancerMode,
                })}
          </Badge>
        )
      }
    >
      {status.error ? (
        <PollError onRetry={() => void status.refetch()}>
          {t("sharding.failed", { message: errorMessage(status.error) })}
        </PollError>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-32">
                    {t("sharding.shards", { count: status.data.shards.length })}
                  </TableHead>
                  <TableHead>{t("sharding.hosts")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.shards.map((shard) => (
                  <TableRow key={shard.id} className="align-top">
                    <TableCell className="font-mono">
                      {shard.id}
                      {shard.draining && (
                        <span className="ml-1.5 font-sans text-warning">
                          {t("sharding.draining")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground [overflow-wrap:anywhere]">
                      {shard.host}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    {t("sharding.collections", { count: status.data.collections.length })}
                  </TableHead>
                  <TableHead className="w-1/2">{t("sharding.key")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.collections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                      {t("sharding.noCollections")}
                    </TableCell>
                  </TableRow>
                ) : (
                  status.data.collections.map((collection) => (
                    <TableRow key={collection.namespace}>
                      <TableCell
                        className="truncate px-3 py-2 font-mono"
                        title={collection.namespace}
                      >
                        {collection.namespace}
                      </TableCell>
                      <TableCell className="truncate font-mono text-muted-foreground">
                        {compactEJson(collection.key).text}
                        {collection.unique && (
                          <span className="ml-1.5 font-sans">{t("sharding.unique")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </MonitorSection>
  );
}
