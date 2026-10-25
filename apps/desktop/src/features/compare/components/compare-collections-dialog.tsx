import { type ConnectionId, commands, type EJsonValue, type JsonValue } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { Progress } from "@odin-db/ui/components/progress";
import { ArrowLeftRight } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { CompareDialog } from "@/features/results";
import { isJsonObject, type JsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";
import { useCompare } from "../hooks/use-compare";
import { type SyncOptions, useSync } from "../hooks/use-sync";
import {
  type CompareSide,
  type CompareTarget,
  isSameCollection,
  percentOf,
  syncReady,
} from "../lib/target";
import { CompareSummary } from "./compare-summary";
import { SyncPanel } from "./sync-panel";
import { TargetPicker } from "./target-picker";

interface CompareCollectionsDialogProps {
  left: CompareSide;
  /** Open connections to compare with, the left one included. */
  targets: readonly CompareTarget[];
  onClose: () => void;
}

/** Compares a collection with another, on this or another connection, matched by `_id`. */
export function CompareCollectionsDialog({
  left,
  targets,
  onClose,
}: CompareCollectionsDialogProps) {
  const { t } = useTranslation("compare");
  const id = useId();
  const nameOf = (connectionId: ConnectionId) =>
    targets.find((target) => target.connectionId === connectionId)?.name ?? "";
  const [right, setRight] = useState<Partial<CompareSide>>(() => {
    const other = targets.find((target) => target.connectionId !== left.connectionId);
    // Another connection usually holds the same collection (staging and production).
    return other
      ? { connectionId: other.connectionId, database: left.database, collection: left.collection }
      : { connectionId: left.connectionId, database: left.database };
  });
  const [filter, setFilter] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pair, setPair] = useState<{ left: JsonObject; right: JsonObject } | null>(null);
  const compare = useCompare();
  const sync = useSync();
  const [mode, setMode] = useState<"compare" | "sync">("compare");
  // The filter of the last comparison, which a sync repeats.
  const [ranFilter, setRanFilter] = useState<JsonValue | null>(null);
  const [syncOptions, setSyncOptions] = useState<SyncOptions>({
    insertMissing: true,
    replaceDifferent: true,
    deleteExtra: false,
  });
  const [confirmation, setConfirmation] = useState("");
  const running = compare.state.status === "running" || sync.state.status === "running";
  const progress = sync.state.status === "running" ? sync.progress : compare.progress;
  const complete =
    right.connectionId !== undefined && Boolean(right.database) && Boolean(right.collection);
  const sameCollection = complete && isSameCollection(left, right as CompareSide);
  const leftName = left.collection;
  const rightName = right.collection ?? "";

  async function run() {
    if (!complete || sameCollection) return;
    let parsed: JsonValue | null = null;
    try {
      const text = filter.trim();
      parsed = text ? await parseShellDocument(text.startsWith("{") ? text : `{ ${text} }`) : null;
      setFilterError(null);
    } catch (error) {
      setFilterError(errorMessage(error));
      return;
    }
    setRanFilter(parsed);
    setMode("compare");
    await compare.start(left, right as CompareSide, parsed);
  }

  const summary = compare.summary;
  const hasDifferences =
    summary !== null &&
    (summary.different ?? 0) + (summary.onlyLeft ?? 0) + (summary.onlyRight ?? 0) > 0;
  const targetReadOnly =
    targets.find((target) => target.connectionId === right.connectionId)?.readOnly ?? false;
  const targetLabel = `${right.connectionId ? nameOf(right.connectionId) : ""} · ${right.database}.${right.collection}`;

  function openSync() {
    if (!summary) return;
    setSyncOptions({
      insertMissing: (summary.onlyLeft ?? 0) > 0,
      replaceDifferent: (summary.different ?? 0) > 0,
      deleteExtra: false,
    });
    setConfirmation("");
    setMode("sync");
  }

  async function applySync() {
    if (!complete) return;
    const synced = await sync.start(left, right as CompareSide, ranFilter, syncOptions);
    if (!synced) return;
    toast.success(
      t("sync.done", {
        inserted: synced.inserted ?? 0,
        replaced: synced.replaced ?? 0,
        deleted: synced.deleted ?? 0,
      }),
    );
    // Compare again, so the counts show what is left.
    setMode("compare");
    await compare.start(left, right as CompareSide, ranFilter);
  }

  async function openDifference(documentId: EJsonValue) {
    if (!complete) return;
    try {
      const found = await call(
        commands.comparedPair(
          left.connectionId,
          right.connectionId as ConnectionId,
          { database: left.database, collection: left.collection },
          { database: right.database ?? "", collection: right.collection ?? "" },
          documentId,
        ),
      );
      if (isJsonObject(found.left) && isJsonObject(found.right)) {
        setPair({ left: found.left, right: found.right });
      } else {
        toast.info(t("pairChanged"));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground text-xs">{t("left")}</span>
              <span className="font-medium">{nameOf(left.connectionId)}</span>
              <span className="font-mono text-xs">
                {left.database}.{left.collection}
              </span>
              <ArrowLeftRight className="ml-auto size-4 text-muted-foreground" />
            </div>
            <TargetPicker
              targets={targets}
              value={right}
              onChange={setRight}
              // The sync applies this comparison, so its target and filter stay put.
              disabled={running || mode === "sync"}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-filter`} className="text-xs">
                {t("filter")}
              </Label>
              <Input
                id={`${id}-filter`}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("filterPlaceholder")}
                spellCheck={false}
                disabled={running || mode === "sync"}
                className="h-8 font-mono text-xs"
              />
            </div>
            {(filterError || sameCollection) && (
              <InlineError>{filterError ?? t("sameCollection")}</InlineError>
            )}
            {running && (
              <div className="flex flex-col gap-1.5">
                <Progress
                  value={percentOf(progress?.compared ?? null, progress?.total ?? null)}
                  aria-label={t("comparing")}
                />
                <span className="text-muted-foreground text-xs tabular-nums">
                  {t("progress", {
                    compared: (progress?.compared ?? 0).toLocaleString(),
                    total: (progress?.total ?? 0).toLocaleString(),
                  })}
                </span>
              </div>
            )}
            {(compare.state.status === "failed" || sync.state.status === "failed") && (
              <InlineError>
                {compare.state.status === "failed"
                  ? compare.state.error
                  : sync.state.status === "failed"
                    ? sync.state.error
                    : null}
              </InlineError>
            )}
            {summary && mode === "sync" && (
              <SyncPanel
                summary={summary}
                targetLabel={targetLabel}
                collection={right.collection ?? ""}
                options={syncOptions}
                onOptionsChange={setSyncOptions}
                confirmation={confirmation}
                onConfirmationChange={setConfirmation}
                disabled={running}
              />
            )}
            {summary && mode === "compare" && !running && (
              <CompareSummary
                summary={summary}
                leftName={leftName}
                rightName={rightName}
                onOpenDifference={(documentId) => void openDifference(documentId)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              {t("actions.close", { ns: "common" })}
            </Button>
            {running ? (
              <Button
                variant="outline"
                onClick={sync.state.status === "running" ? sync.cancel : compare.cancel}
              >
                {t("stop")}
              </Button>
            ) : mode === "sync" ? (
              <>
                <Button variant="outline" onClick={() => setMode("compare")}>
                  {t("sync.back")}
                </Button>
                <Button
                  variant={syncOptions.deleteExtra ? "destructive" : "default"}
                  disabled={!syncReady(syncOptions, confirmation, right.collection ?? "")}
                  onClick={() => void applySync()}
                >
                  {t("sync.apply", { collection: right.collection })}
                </Button>
              </>
            ) : (
              <>
                {hasDifferences && (
                  <Button
                    variant="outline"
                    onClick={openSync}
                    disabled={targetReadOnly}
                    title={targetReadOnly ? t("sync.readOnly") : undefined}
                  >
                    {t("sync.open")}
                  </Button>
                )}
                <Button onClick={() => void run()} disabled={!complete || sameCollection}>
                  {summary ? t("again") : t("run")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pair && <CompareDialog left={pair.left} right={pair.right} onClose={() => setPair(null)} />}
    </>
  );
}
