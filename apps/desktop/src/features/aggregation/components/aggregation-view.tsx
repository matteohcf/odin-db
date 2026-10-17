import {
  type ConnectionInfo,
  commands,
  type EJsonDocument,
  type Namespace,
} from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { CircleAlert, Code2, Copy, Download, Play, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";
import { QueryCodeDialog } from "@/components/query-code-dialog";
import {
  DocumentEditorDialog,
  ResultsPanel,
  ResultsStatusBar,
  useResultsController,
  useResultsState,
} from "@/features/results";
import { ExportDialog } from "@/features/transfer";
import { useShortcut } from "@/hooks/use-shortcut";
import { call } from "@/lib/ipc";
import { toShellSyntax } from "@/lib/shell-syntax";
import { isWriteOperator } from "../lib/operators";
import { buildPipeline, pipelineToText } from "../lib/pipeline";
import { createPipelineStore } from "../store/pipeline-store";
import { pipelineKey } from "../store/saved-pipelines-store";
import { SavedPipelinesMenu } from "./saved-pipelines-menu";
import { StageCard } from "./stage-card";

interface AggregationViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  /** Whether this view is the one on screen, which takes the rerun shortcut. */
  active: boolean;
}

const isMac = navigator.userAgent.includes("Mac");

/** Build a pipeline stage by stage with live previews, then run it in full. */
export function AggregationView({ connection, namespace, active }: AggregationViewProps) {
  const { t } = useTranslation("aggregation");
  const [store] = useState(createPipelineStore);
  const stages = useStore(store, (s) => s.stages);
  const actions = store.getState();
  const results = useResultsController();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [confirmWrite, setConfirmWrite] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [exporting, setExporting] = useState<EJsonDocument[] | null>(null);
  const resultColumns = useResultsState(results, (s) => s.columns);
  const resultsReady = useResultsState(results, (s) => s.status === "ready");
  const lastPipeline = useRef<EJsonDocument[]>([]);
  const [codePipeline, setCodePipeline] = useState<EJsonDocument[] | null>(null);

  const writeStage = stages.find((s) => s.enabled && isWriteOperator(s.operator));
  const label = `${namespace.database}.${namespace.collection}`;

  useShortcut("rerun", () => void run(), active);

  async function showCode() {
    const built = await buildPipeline(stages);
    if (!built.ok) {
      const number = stages.findIndex((s) => s.id === built.stageId) + 1;
      setRunError(`${t("stage.label", { number })}: ${built.error}`);
      return;
    }
    setRunError(null);
    setCodePipeline(built.pipeline);
  }

  async function run(confirmed = false) {
    if (writeStage && connection.readOnly) {
      setRunError(t("write.readOnly"));
      return;
    }
    if (writeStage && !confirmed) {
      setConfirmWrite(writeStage.operator);
      return;
    }
    const built = await buildPipeline(stages);
    if (!built.ok) {
      const number = stages.findIndex((s) => s.id === built.stageId) + 1;
      setRunError(`${t("stage.label", { number })}: ${built.error}`);
      return;
    }
    setRunError(null);
    setSelectedIndex(null);
    setResultsOpen(true);
    lastPipeline.current = built.pipeline;
    void results.run((batchSize) =>
      call(
        commands.aggregateDocuments(connection.id, namespace, {
          pipeline: built.pipeline,
          batchSize,
        }),
      ),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={() => actions.add("$match")}>
          <Plus />
          {t("toolbar.addStage")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(pipelineToText(stages));
            toast.success(t("toolbar.copied"));
          }}
        >
          <Copy />
          {t("toolbar.copy")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void showCode()}>
          <Code2 />
          {t("queryCode.toolbar", { ns: "common" })}
        </Button>
        <SavedPipelinesMenu
          storageKey={pipelineKey(connection.profileId, namespace.database, namespace.collection)}
          stages={stages}
          onLoad={(pipeline) => {
            actions.replace(pipeline.stages);
            setRunError(null);
            toast.success(t("saved.loaded", { name: pipeline.name }));
          }}
        />
        {runError && (
          <p
            role="alert"
            className="flex min-w-0 items-center gap-1.5 text-destructive text-xs selectable"
          >
            <CircleAlert className="size-3.5 shrink-0" />
            <span className="truncate" title={runError}>
              {runError}
            </span>
          </p>
        )}
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => void run()}
          title={t("toolbar.runHint")}
        >
          <Play className="fill-current" />
          {t("toolbar.run")}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">
            {isMac ? "⌘↵" : "Ctrl ↵"}
          </Kbd>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
        <ol className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
          {stages.map((stage, index) => (
            <li key={stage.id}>
              <StageCard
                connectionId={connection.id}
                namespace={namespace}
                stages={stages}
                index={index}
                onOperatorChange={(operator) => actions.setOperator(stage.id, operator)}
                onBodyChange={(body) => actions.update(stage.id, { body })}
                onToggle={(enabled) => actions.update(stage.id, { enabled })}
                onMove={(delta) => actions.move(stage.id, delta)}
                onRemove={() => actions.remove(stage.id)}
                onAddAfter={() => actions.add("$match", stage.id)}
                onRun={() => void run()}
              />
            </li>
          ))}
          <li>
            <Button
              variant="ghost"
              className="h-10 w-full border border-dashed text-muted-foreground"
              onClick={() => actions.add("$match")}
            >
              <Plus />
              {t("toolbar.addStage")}
            </Button>
          </li>
        </ol>
      </div>

      {resultsOpen && (
        <section
          aria-label={t("results.title")}
          className="flex h-[45%] min-h-48 shrink-0 flex-col border-t"
        >
          <header className="flex h-9 shrink-0 items-center gap-1 border-b bg-sidebar px-3">
            <h2 className="font-medium text-xs">{t("results.title")}</h2>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs"
              disabled={!resultsReady}
              onClick={() => setExporting(lastPipeline.current)}
            >
              <Download />
              {t("menu.export", { ns: "transfer" })}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t("results.close")}
              onClick={() => {
                setResultsOpen(false);
                results.reset();
              }}
            >
              <X />
            </Button>
          </header>
          <ResultsPanel
            controller={results}
            label={t("results.label", { collection: namespace.collection })}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            empty={<p>{t("results.empty")}</p>}
            idle={<p className="p-6 text-muted-foreground">{t("results.idle")}</p>}
            actions={{
              openMode: "view",
              onOpen: (row) => setViewing(toShellSyntax(row)),
              onCopy: (row) => void navigator.clipboard.writeText(toShellSyntax(row)),
            }}
          />
          <ResultsStatusBar controller={results} />
        </section>
      )}

      {codePipeline && (
        <QueryCodeDialog
          source={{
            kind: "aggregate",
            database: namespace.database,
            collection: namespace.collection,
            pipeline: codePipeline,
          }}
          onClose={() => setCodePipeline(null)}
        />
      )}

      {exporting && (
        <ExportDialog
          connectionId={connection.id}
          namespace={namespace}
          source={{ kind: "aggregate", pipeline: exporting }}
          columns={resultColumns}
          onClose={() => setExporting(null)}
        />
      )}

      {viewing !== null && (
        <DocumentEditorDialog
          open
          mode="view"
          namespace={label}
          initialText={viewing}
          onSave={async () => {}}
          onClose={() => setViewing(null)}
        />
      )}

      <AlertDialog
        open={confirmWrite !== null}
        onOpenChange={(open) => !open && setConfirmWrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("write.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("write.body", { operator: confirmWrite ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmWrite(null);
                void run(true);
              }}
            >
              {t("write.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
