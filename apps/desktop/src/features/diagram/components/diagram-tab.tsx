import type { DatabaseDiagram, DiagramProgress } from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Progress } from "@odin-db/ui/components/progress";
import { ReactFlowProvider } from "@xyflow/react";
import { RefreshCw, Unplug, Waypoints } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnectionOf, useOpenCollection, useProfile } from "@/features/connections";
import type { DiagramTab as DiagramTabModel } from "@/features/workspace";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";
import { DiagramCanvas } from "./diagram-canvas";
import { DiagramMessage } from "./diagram-message";

/** A database's diagram: samples it on open, then shows its collections and references. */
export function DiagramTab({ tab }: { tab: DiagramTabModel }) {
  const { t } = useTranslation("diagram");
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();
  const openCollection = useOpenCollection();
  const operation = useOperation<
    { kind: "progress"; value: DiagramProgress } | { kind: "finished"; value: DatabaseDiagram }
  >();
  const [progress, setProgress] = useState<DiagramProgress | null>(null);
  const [diagram, setDiagram] = useState<DatabaseDiagram | null>(null);
  const connectionId = connection?.id;

  const analyze = useCallback(() => {
    if (!connectionId) return;
    setProgress(null);
    void operation.start(
      (channel) => call(commands.databaseDiagram(connectionId, tab.database, channel)),
      (event) => {
        if (event.kind === "progress") setProgress(event.value);
        else setDiagram(event.value);
      },
    );
  }, [connectionId, tab.database, operation.start]);

  // Analyzes on open and after a reconnect; "Analyze again" refreshes on demand.
  useEffect(() => {
    analyze();
  }, [analyze]);

  if (!connection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Unplug className="size-5 text-muted-foreground" />
        <p className="font-medium">{t("disconnected", { name: profile?.name ?? "" })}</p>
        <Button
          size="sm"
          onClick={() => connect.mutate(tab.profileId)}
          disabled={connect.isPending}
        >
          {t("connect")}
        </Button>
      </div>
    );
  }

  const running = operation.state.status === "running";
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <Waypoints className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate font-semibold text-base">
            {t("title", { database: tab.database })}
          </h1>
          {diagram && (
            <p className="hidden truncate text-muted-foreground text-xs md:block">
              {t("subtitle", {
                collections: diagram.collections.length,
                links: diagram.links.length,
              })}
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {running && (
            <>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("analyzing", { done, total })}
              </span>
              <Progress value={total ? (done / total) * 100 : null} className="h-1.5 w-32" />
              <Button size="sm" variant="ghost" onClick={operation.cancel}>
                {t("cancel")}
              </Button>
            </>
          )}
          {!running && (
            <Button size="sm" variant="outline" onClick={analyze}>
              <RefreshCw />
              {t("retry")}
            </Button>
          )}
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {operation.state.status === "failed" && !diagram ? (
          <DiagramMessage>{t("failed", { message: operation.state.error })}</DiagramMessage>
        ) : operation.state.status === "cancelled" && !diagram ? (
          <DiagramMessage>{t("cancelled")}</DiagramMessage>
        ) : diagram && diagram.collections.length === 0 ? (
          <DiagramMessage>{t("empty")}</DiagramMessage>
        ) : diagram ? (
          <ReactFlowProvider>
            <DiagramCanvas
              diagram={diagram}
              storageKey={`${tab.profileId}/${tab.database}`}
              onOpen={(collection) => {
                const kind = diagram.collections.find((c) => c.name === collection)?.kind;
                openCollection({
                  profileId: tab.profileId,
                  database: tab.database,
                  collection,
                  collectionKind: kind ?? "collection",
                });
              }}
            />
          </ReactFlowProvider>
        ) : null}
      </div>
    </div>
  );
}
