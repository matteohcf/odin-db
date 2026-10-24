import { type ConnectionInfo, commands, type ReplicaMember } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { cn } from "@odin-db/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { uptime } from "../lib/rates";

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
    <section className="mt-6 flex flex-col gap-2" aria-label={t("replica.title")}>
      <div className="flex items-baseline gap-2">
        <h2 className="font-semibold text-sm">{t("replica.title")}</h2>
        {status.data && (
          <span className="font-mono text-muted-foreground text-xs">{status.data.set}</span>
        )}
      </div>
      {status.error ? (
        <p role="alert" className="text-destructive text-xs selectable">
          {t("replica.failed", { message: errorMessage(status.error) })}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-3xl table-fixed text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("replica.member")}</th>
                <th className="w-32 px-3 py-2 font-medium">{t("replica.state")}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">{t("replica.lag")}</th>
                <th className="w-20 px-3 py-2 text-right font-medium">{t("replica.ping")}</th>
                <th className="w-24 px-3 py-2 text-right font-medium">{t("replica.uptime")}</th>
                <th className="w-48 px-3 py-2 font-medium">{t("replica.syncSource")}</th>
              </tr>
            </thead>
            <tbody>
              {status.data.members.map((member) => (
                <tr key={member.name} className="border-t align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono">{member.name}</span>
                    {member.isSelf && (
                      <span className="ml-1.5 text-muted-foreground">{t("replica.self")}</span>
                    )}
                    {member.message && (
                      <p className="mt-0.5 text-destructive [overflow-wrap:anywhere]">
                        {member.message}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <MemberState member={member} />
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      (member.lagSeconds ?? 0) >= LAG_WARNING && "font-medium text-warning",
                    )}
                  >
                    {member.lagSeconds == null ? "—" : `${number(member.lagSeconds)} s`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {member.pingMs == null ? "—" : `${number(member.pingMs)} ms`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {member.healthy ? uptime(member.uptimeSeconds ?? 0) : "—"}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-muted-foreground">
                    {member.syncSource ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MemberState({ member }: { member: ReplicaMember }) {
  if (!member.healthy)
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        {member.state || "DOWN"}
      </Badge>
    );
  if (member.state === "PRIMARY")
    return <Badge className="bg-success/15 text-success hover:bg-success/15">{member.state}</Badge>;
  if (member.state === "SECONDARY") return <Badge variant="secondary">{member.state}</Badge>;
  return (
    <Badge variant="outline" className="text-warning">
      {member.state}
    </Badge>
  );
}
