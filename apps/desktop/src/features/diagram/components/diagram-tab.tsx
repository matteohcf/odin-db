import type {
  DatabaseDiagram,
  DiagramEvent,
  DiagramProgress,
  DiagramScanSummary,
  ScanId,
  ScanPace,
} from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { Progress } from "@odin-db/ui/components/progress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { RefreshCw, Unplug, Waypoints } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import {
  collectionsQuery,
  databasesQuery,
  useConnect,
  useConnectionOf,
  useOpenCollection,
  useProfile,
} from "@/features/connections";
import type { DiagramTab as DiagramTabModel } from "@/features/workspace";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { scanKeys, useDiagramScan, useDiagramScans } from "../api/scans";
import { DiagramCanvas } from "./diagram-canvas";
import { DiagramMessage } from "./diagram-message";
import { NewScanDialog } from "./new-scan-dialog";
import { ScanSelect } from "./scan-select";

/**
 * A database's diagram. Opens its newest saved scan without touching the server; a new scan
 * starts only from the dialog, at the pace picked there (ADR-0060).
 */
export function DiagramTab({ tab }: { tab: DiagramTabModel }) {
  const { t } = useTranslation("diagram");
  const queryClient = useQueryClient();
  const profile = useProfile(tab.profileId);
  const connection = useConnectionOf(tab.profileId);
  const connect = useConnect();
  const openCollection = useOpenCollection();
  const operation = useOperation<DiagramEvent>();
  const [progress, setProgress] = useState<DiagramProgress | null>(null);
  const [picked, setPicked] = useState<ScanId | null>(null);
  // A finished scan that could not be saved is still shown.
  const [unsaved, setUnsaved] = useState<{ diagram: DatabaseDiagram; error: string } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const connectionId = connection?.id;

  const scans = useDiagramScans(tab.profileId, tab.database);
  // A picked scan that is gone (deleted in settings, pruned) falls back to the newest.
  const selected =
    (scans.data?.some((scan) => scan.id === picked) ? picked : scans.data?.[0]?.id) ?? null;
  const saved = useDiagramScan(unsaved ? null : selected);
  const diagram = unsaved?.diagram ?? saved.data ?? null;

  // The sidebar has usually loaded both already: the dialog reuses them as they are.
  const collections = useQuery({
    ...collectionsQuery(connectionId ?? "", tab.database),
    enabled: dialogOpen && connectionId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const databases = useQuery({
    ...databasesQuery(connectionId ?? ""),
    enabled: dialogOpen && connectionId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const bytes = databases.data?.find((d) => d.name === tab.database)?.sizeOnDisk;

  // A database never scanned asks how to scan it, once (after connecting, if need be); later
  // empty lists (cleared in settings) wait for "New scan".
  const asked = useRef(false);
  useEffect(() => {
    if (!scans.data || asked.current) return;
    if (scans.data.length > 0) {
      asked.current = true;
    } else if (connectionId) {
      asked.current = true;
      setDialogOpen(true);
    }
  }, [scans.data, connectionId]);

  const start = useCallback(
    (pace: ScanPace) => {
      if (!connectionId) return;
      setDialogOpen(false);
      setProgress(null);
      const keep = useSettings.getState().diagramScansKept;
      void operation.start(
        (channel) =>
          call(commands.databaseDiagram(connectionId, tab.database, pace, keep, channel)),
        (event) => {
          if (event.kind === "progress") {
            setProgress(event.value);
            return;
          }
          const { diagram: found, scan, saveError } = event.value;
          if (scan) {
            queryClient.setQueryData(scanKeys.scan(scan.id), found);
            // Listed at once, so the new scan shows without a flash of the previous one.
            const list = scanKeys.list(tab.profileId, tab.database);
            queryClient.setQueryData<DiagramScanSummary[]>(list, (old = []) => [scan, ...old]);
            void queryClient.invalidateQueries({ queryKey: list });
            setPicked(scan.id);
            setUnsaved(null);
          } else {
            setUnsaved({ diagram: found, error: saveError ?? "" });
          }
        },
      );
    },
    [connectionId, tab.database, tab.profileId, operation.start, queryClient],
  );

  if (!connection && !diagram && !scans.isPending && !saved.isLoading) {
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
  const skipped = diagram?.collections.filter((c) => c.error !== null).length ?? 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={Waypoints}
        title={t("title", { database: tab.database })}
        subtitle={
          diagram &&
          t("subtitle", {
            collections: diagram.collections.length,
            links: diagram.links.length,
          })
        }
      >
        {skipped > 0 && (
          <Badge variant="warning" title={t("scan.skippedHint")}>
            {t("scan.skipped", { count: skipped })}
          </Badge>
        )}
        {unsaved && (
          <Badge variant="warning" title={unsaved.error}>
            {t("scan.notSaved")}
          </Badge>
        )}
        {/* With a diagram on screen, a failed new scan would otherwise go unnoticed. */}
        {operation.state.status === "failed" && diagram && (
          <Badge variant="warning" title={operation.state.error}>
            {t("scan.failed")}
          </Badge>
        )}
        {!running && scans.data && scans.data.length > 0 && selected && (
          <ScanSelect
            scans={scans.data}
            value={unsaved ? "" : selected}
            onChange={(id) => {
              setUnsaved(null);
              setPicked(id);
            }}
          />
        )}
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogOpen(true)}
            disabled={!connection}
            title={connection ? undefined : t("disconnected", { name: profile?.name ?? "" })}
          >
            <RefreshCw />
            {t("scan.new")}
          </Button>
        )}
      </PageHeader>
      <div className="relative min-h-0 flex-1">
        {operation.state.status === "failed" && !diagram ? (
          <DiagramMessage>{t("failed", { message: operation.state.error })}</DiagramMessage>
        ) : operation.state.status === "cancelled" && !diagram ? (
          <DiagramMessage>{t("cancelled")}</DiagramMessage>
        ) : saved.isError && !diagram ? (
          <DiagramMessage>{t("scan.unreadable", { message: String(saved.error) })}</DiagramMessage>
        ) : diagram && diagram.collections.length === 0 ? (
          <DiagramMessage>{t("empty")}</DiagramMessage>
        ) : diagram ? (
          <ReactFlowProvider>
            <DiagramCanvas
              diagram={diagram}
              database={tab.database}
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
        ) : scans.data?.length === 0 && !running ? (
          <DiagramMessage>{t("scan.none")}</DiagramMessage>
        ) : null}
      </div>
      {dialogOpen && !collections.isPending && !databases.isPending && (
        <NewScanDialog
          database={tab.database}
          collections={collections.data?.length ?? 0}
          bytes={bytes ?? 0}
          onStart={start}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
