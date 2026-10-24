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
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import {
  CircleAlert,
  ClipboardPaste,
  Code2,
  Copy,
  Download,
  FileCode2,
  Play,
  Plus,
  Rows3,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";
import { CodeEditor } from "@/components/code-editor";
import { QueryCodeDialog } from "@/components/query-code-dialog";
import {
  DocumentEditorDialog,
  ResultsPanel,
  ResultsStatusBar,
  useResultsController,
  useResultsState,
} from "@/features/results";
import { ExportDialog } from "@/features/transfer";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { useShortcut } from "@/hooks/use-shortcut";
import { call, errorMessage } from "@/lib/ipc";
import { withTimeLimit } from "@/lib/settings";
import { toShellSyntax } from "@/lib/shell-syntax";
import { isWriteOperator } from "../lib/operators";
import { buildPipeline, pipelineFromText, pipelineToText } from "../lib/pipeline";
import { createPipelineStore } from "../store/pipeline-store";
import { pipelineKey } from "../store/saved-pipelines-store";
import { SavedPipelinesMenu } from "./saved-pipelines-menu";
import { StageCard } from "./stage-card";

interface AggregationViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  /** Whether this view is the one on screen, which takes the rerun shortcut. */
  active: boolean;
  /** A pipeline handed over (e.g. from My queries); a new nonce loads it again. */
  pendingPipeline?: { text: string; nonce: string } | undefined;
}

/** Build a pipeline stage by stage with live previews, then run it in full. */
export function AggregationView({
  connection,
  namespace,
  active,
  pendingPipeline,
}: AggregationViewProps) {
  const submitKeys = useKeybindingLabel("submit");
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

  // Like Compass: the whole pipeline as one editable text, or as stage cards.
  const [mode, setMode] = useState<"stages" | "text">("stages");
  const [text, setText] = useState("");
  // The text last written from the stages: unchanged, it is not parsed back, so stages the text
  // cannot carry (disabled ones) survive a trip through text mode.
  const generated = useRef("");
  // The text editor reads its value once; a new key loads text set from outside.
  const [editorKey, setEditorKey] = useState(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const namespaceLabel = `${namespace.database}.${namespace.collection}`;

  useShortcut("rerun", () => void run(), active);

  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingPipeline || loaded.current === pendingPipeline.nonce) return;
    loaded.current = pendingPipeline.nonce;
    pipelineFromText(pendingPipeline.text).then(
      (stages) => {
        actions.replace(stages);
        setMode("stages");
        setRunError(null);
      },
      (error: unknown) => setRunError(t("text.invalid", { message: errorMessage(error) })),
    );
  }, [pendingPipeline, actions, t]);

  /** Shows the current stages in the text editor. */
  function writeText() {
    const written = pipelineToText(store.getState().stages);
    generated.current = written;
    setText(written);
    setEditorKey((key) => key + 1);
  }

  /** Replaces the stages from outside the editors (paste, load, undo), keeping text mode in step. */
  function replaceStages(next: Parameters<typeof actions.replace>[0]) {
    actions.replace(next);
    if (modeRef.current === "text") writeText();
  }

  async function paste(text: string) {
    try {
      const pasted = await pipelineFromText(text);
      const previous = store.getState().stages;
      replaceStages(pasted);
      setRunError(null);
      toast.success(t("toolbar.pasted", { count: pasted.length }), {
        action: { label: t("toolbar.undo"), onClick: () => replaceStages(previous) },
      });
    } catch (error) {
      toast.error(t("toolbar.pasteFailed", { message: errorMessage(error) }));
    }
  }

  /** In text mode, turns the text into stages; false (with the error shown) if it does not parse. */
  async function syncText(): Promise<boolean> {
    if (mode !== "text" || text === generated.current) return true;
    try {
      actions.replace(await pipelineFromText(text));
      generated.current = text;
      return true;
    } catch (error) {
      setRunError(t("text.invalid", { message: errorMessage(error) }));
      return false;
    }
  }

  async function switchMode(next: "stages" | "text") {
    if (next === mode) return;
    if (next === "text") {
      writeText();
      setRunError(null);
      setMode("text");
    } else if (await syncText()) {
      setRunError(null);
      setMode("stages");
    }
  }

  async function showCode() {
    if (!(await syncText())) return;
    const stages = store.getState().stages;
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
    if (!(await syncText())) return;
    const stages = store.getState().stages;
    const writeStage = stages.find((s) => s.enabled && isWriteOperator(s.operator));
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
          options: withTimeLimit(),
        }),
      ),
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onPaste={(event) => {
        // Pasting into a stage editor or field stays a normal paste.
        const target = event.target as HTMLElement;
        if (target.closest("input, textarea, [contenteditable=true]")) return;
        event.preventDefault();
        void paste(event.clipboardData.getData("text"));
      }}
    >
      {/* A container, so secondary labels give way to icons before anything overflows. */}
      <div className="@container flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        {mode === "stages" && (
          <Button variant="outline" size="sm" onClick={() => actions.add("$match")}>
            <Plus />
            {t("toolbar.addStage")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("toolbar.copy")}
          title={t("toolbar.copy")}
          onClick={() => {
            void navigator.clipboard.writeText(mode === "text" ? text : pipelineToText(stages));
            toast.success(t("toolbar.copied"));
          }}
        >
          <Copy />
          <span className="hidden @4xl:inline">{t("toolbar.copy")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("toolbar.paste")}
          title={t("toolbar.pasteHint")}
          onClick={() => void navigator.clipboard.readText().then(paste)}
        >
          <ClipboardPaste />
          <span className="hidden @4xl:inline">{t("toolbar.paste")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("queryCode.toolbar", { ns: "common" })}
          title={t("queryCode.toolbar", { ns: "common" })}
          onClick={() => void showCode()}
        >
          <Code2 />
          <span className="hidden @4xl:inline">{t("queryCode.toolbar", { ns: "common" })}</span>
        </Button>
        <SavedPipelinesMenu
          storageKey={pipelineKey(connection.profileId, namespace.database, namespace.collection)}
          stages={stages}
          onOpen={syncText}
          onLoad={(pipeline) => {
            replaceStages(pipeline.stages);
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
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={mode}
          onValueChange={(value) => value && void switchMode(value as "stages" | "text")}
          aria-label={t("text.label")}
          className="ml-auto"
        >
          <ToggleGroupItem
            value="stages"
            aria-label={t("text.stages")}
            title={t("text.stages")}
            className="gap-1.5 px-2.5"
          >
            <Rows3 />
            <span className="hidden @3xl:inline">{t("text.stages")}</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="text"
            aria-label={t("text.text")}
            title={t("text.text")}
            className="gap-1.5 px-2.5"
          >
            <FileCode2 />
            <span className="hidden @3xl:inline">{t("text.text")}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Button size="sm" onClick={() => void run()} title={t("toolbar.runHint")}>
          <Play className="fill-current" />
          {t("toolbar.run")}
          {submitKeys && (
            <Kbd className="hidden bg-primary-foreground/15 text-primary-foreground @3xl:inline-flex">
              {submitKeys}
            </Kbd>
          )}
        </Button>
      </div>

      {mode === "text" ? (
        <div className="min-h-0 flex-1 bg-muted/30 p-3">
          <CodeEditor
            key={editorKey}
            initialValue={text}
            onChange={setText}
            onSubmit={() => void run()}
            ariaLabel={t("text.editor")}
            className="mx-auto h-full max-w-6xl rounded-lg border bg-background"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30">
          <ol className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
            {stages.map((stage, index) => (
              <li key={stage.id}>
                <StageCard
                  connectionId={connection.id}
                  namespace={namespace}
                  stages={stages}
                  index={index}
                  onOperatorChange={(operator, field) =>
                    actions.setOperator(stage.id, operator, field)
                  }
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
      )}

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
          namespace={namespaceLabel}
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
