import { type ConnectionInfo, commands, type ReplicaMember } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { cn } from "@odin-db/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { uptime } from "../lib/rates";
import { MonitorSection } from "./monitor-section";

interface ReplicaSetSectionProps {
  connection: ConnectionInfo;
  polling: number | false;
}

// Seconds behind the primary past which a secondary is worth a look.
const LAG_WARNING = 10;

/** Members of the replica set, with state, health and replication lag; nothing on a standalone. */
export function ReplicaSetSection({ connection, polling }: ReplicaSetSectionProps) {
  const { t, i18n } = useTranslation("monitor");
  const status = useQuery({
    queryKey: ["replica-set-status", connection.id],
    queryFn: () => call(commands.replicaSetStatus(connection.id)),
    refetchInterval: polling,
  });
  if (status.data === null || status.isPending) return null;
  const number = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: value < 10 ? 1 : 0 });

  return (
    <MonitorSection
      title={t("replica.title")}
      detail={
        status.data && (
          <span className="font-mono text-muted-foreground text-xs">{status.data.set}</span>
        )
      }
    >
      {status.error ? (
        <p role="alert" className="text-destructive text-xs selectable">
          {t("replica.failed", { message: errorMessage(status.error) })}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-3xl table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("replica.member")}</TableHead>
                <TableHead className="w-32">{t("replica.state")}</TableHead>
                <TableHead className="w-28 text-right">{t("replica.lag")}</TableHead>
                <TableHead className="w-20 text-right">{t("replica.ping")}</TableHead>
                <TableHead className="w-24 text-right">{t("replica.uptime")}</TableHead>
                <TableHead className="w-48">{t("replica.syncSource")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.data.members.map((member) => (
                <TableRow key={member.name} className="align-top">
                  <TableCell>
                    <span className="font-mono">{member.name}</span>
                    {member.isSelf && (
                      <span className="ml-1.5 text-muted-foreground">{t("replica.self")}</span>
                    )}
                    {member.message && (
                      <p className="mt-0.5 text-destructive [overflow-wrap:anywhere]">
                        {member.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <MemberState member={member} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      (member.lagSeconds ?? 0) >= LAG_WARNING && "font-medium text-warning",
                    )}
                  >
                    {member.lagSeconds == null ? "—" : `${number(member.lagSeconds)} s`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {member.pingMs == null ? "—" : `${number(member.pingMs)} ms`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {member.healthy ? uptime(member.uptimeSeconds ?? 0) : "—"}
                  </TableCell>
                  <TableCell className="truncate font-mono text-muted-foreground">
                    {member.syncSource ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </MonitorSection>
  );
}

function MemberState({ member }: { member: ReplicaMember }) {
  if (!member.healthy) return <Badge variant="danger">{member.state || "DOWN"}</Badge>;
  if (member.state === "PRIMARY") return <Badge variant="success">{member.state}</Badge>;
  if (member.state === "SECONDARY") return <Badge variant="secondary">{member.state}</Badge>;
  return <Badge variant="warning">{member.state}</Badge>;
}
