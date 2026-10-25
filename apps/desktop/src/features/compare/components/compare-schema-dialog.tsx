import {
  type ConnectionId,
  commands,
  type IndexInfo,
  type SchemaCompareProgress,
  type SchemaComparison,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Progress } from "@odin-db/ui/components/progress";
import { Switch } from "@odin-db/ui/components/switch";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { useOperation } from "@/hooks/use-operation";
import { call, errorMessage } from "@/lib/ipc";
import { indexRequestOf } from "../lib/index-request";
import type { CompareTarget } from "../lib/target";
import { percentOf } from "../lib/target";
import { SchemaDifferenceRow } from "./schema-difference-row";
import { TargetPicker } from "./target-picker";

type SchemaEvent =
  | { kind: "progress"; value: SchemaCompareProgress }
  | { kind: "finished"; value: SchemaComparison };

interface CompareSchemaDialogProps {
  left: { connectionId: ConnectionId; database: string };
  /** Open connections to compare with, this one included. */
  targets: readonly CompareTarget[];
  onClose: () => void;
}

/** Two databases side by side: collections, fields, indexes and rules that differ. */
export function CompareSchemaDialog({ left, targets, onClose }: CompareSchemaDialogProps) {
  const { t } = useTranslation("compare");
  const id = useId();
  const [right, setRight] = useState<{ connectionId?: ConnectionId; database?: string }>({});
  const [progress, setProgress] = useState<SchemaCompareProgress | null>(null);
  const [result, setResult] = useState<SchemaComparison | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const operation = useOperation<SchemaEvent>(t("schema.title"));
  const nameOf = (connectionId: ConnectionId | undefined) =>
    targets.find((target) => target.connectionId === connectionId)?.name ?? "";
  const leftLabel = `${nameOf(left.connectionId)} · ${left.database}`;
  const rightLabel = `${nameOf(right.connectionId)} · ${right.database ?? ""}`;
  const readOnly = (connectionId: ConnectionId | undefined) =>
    targets.find((target) => target.connectionId === connectionId)?.readOnly ?? true;
  const ready =
    right.connectionId !== undefined &&
    Boolean(right.database) &&
    !(right.connectionId === left.connectionId && right.database === left.database);
  const running = operation.state.status === "running";

  async function run() {
    if (!ready || !right.connectionId || !right.database) return;
    const rightConnection = right.connectionId;
    const rightDatabase = right.database;
    setResult(null);
    setProgress(null);
    await operation.start(
      (channel) =>
        call(
          commands.compareSchemas(
            left.connectionId,
            rightConnection,
            { leftDatabase: left.database, rightDatabase },
            channel,
          ),
        ),
      (event) => (event.kind === "progress" ? setProgress(event.value) : setResult(event.value)),
    );
  }

  async function create(side: "left" | "right", collection: string, index: IndexInfo) {
    const connectionId = side === "left" ? left.connectionId : right.connectionId;
    const database = side === "left" ? left.database : right.database;
    if (!connectionId || !database) return;
    try {
      await call(
        commands.createIndex(connectionId, { database, collection }, indexRequestOf(index)),
      );
      toast.success(t("schema.created", { name: index.name, collection }));
      await run();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const missingOnRight =
    result?.collections.flatMap((comparison) =>
      comparison.indexes
        .filter((difference) => difference.left && !difference.right)
        .map((difference) => ({
          collection: comparison.name,
          index: difference.left as IndexInfo,
        })),
    ) ?? [];
  async function createAllOnRight() {
    if (!right.connectionId || !right.database) return;
    for (const { collection, index } of missingOnRight) {
      try {
        await call(
          commands.createIndex(
            right.connectionId,
            { database: right.database, collection },
            indexRequestOf(index),
          ),
        );
      } catch (error) {
        toast.error(`${collection}: ${errorMessage(error)}`);
      }
    }
    toast.success(t("schema.createdAll", { count: missingOnRight.length }));
    await run();
  }

  const differs = (comparison: SchemaComparison["collections"][number]) =>
    comparison.presence !== "both" ||
    comparison.fields.length > 0 ||
    comparison.indexes.length > 0 ||
    comparison.validation !== null ||
    comparison.error !== null;
  const shown = result?.collections.filter((c) => !onlyDifferences || differs(c)) ?? [];
  const counts = result && {
    leftOnly: result.collections.filter((c) => c.presence === "leftOnly").length,
    rightOnly: result.collections.filter((c) => c.presence === "rightOnly").length,
    differing: result.collections.filter((c) => c.presence === "both" && differs(c)).length,
    identical: result.collections.filter((c) => !differs(c)).length,
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("schema.title")}</DialogTitle>
          <DialogDescription>{t("schema.description", { left: leftLabel })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TargetPicker
              targets={targets}
              value={right}
              onChange={setRight}
              disabled={running}
              withCollection={false}
            />
          </div>
          <Button size="sm" disabled={!ready || running} onClick={() => void run()}>
            {result ? t("schema.again") : t("schema.compare")}
          </Button>
        </div>
        {running && (
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <Progress
              value={percentOf(progress?.done ?? 0, progress?.total ?? 0)}
              className="h-1.5"
            />
            <span className="shrink-0 tabular-nums">
              {t("schema.progress", { done: progress?.done ?? 0, total: progress?.total ?? 0 })}
            </span>
            <Button size="sm" variant="ghost" onClick={operation.cancel}>
              {t("schema.stop")}
            </Button>
          </div>
        )}
        {operation.state.status === "failed" && <InlineError>{operation.state.error}</InlineError>}
        {result && counts && (
          <>
            <div className="flex items-center gap-3">
              <p className="text-sm">{t("schema.summary", counts)}</p>
              <label htmlFor={`${id}-only`} className="ml-auto flex items-center gap-2 text-xs">
                {t("schema.onlyDifferences")}
                <Switch
                  id={`${id}-only`}
                  checked={onlyDifferences}
                  onCheckedChange={setOnlyDifferences}
                />
              </label>
            </div>
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
              {shown.length === 0 ? (
                <li className="p-6 text-center text-muted-foreground text-sm">
                  {t("schema.same")}
                </li>
              ) : (
                shown.map((comparison) => (
                  <SchemaDifferenceRow
                    key={comparison.name}
                    comparison={comparison}
                    leftLabel={leftLabel}
                    rightLabel={rightLabel}
                    onCreateLeft={
                      readOnly(left.connectionId)
                        ? undefined
                        : (collection, index) => void create("left", collection, index)
                    }
                    onCreateRight={
                      readOnly(right.connectionId)
                        ? undefined
                        : (collection, index) => void create("right", collection, index)
                    }
                  />
                ))
              )}
            </ul>
          </>
        )}
        <DialogFooter className="sm:justify-between">
          <span>
            {missingOnRight.length > 0 && !readOnly(right.connectionId) && (
              <Button variant="outline" onClick={() => void createAllOnRight()} disabled={running}>
                {t("schema.createAll", { count: missingOnRight.length, side: rightLabel })}
              </Button>
            )}
          </span>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {t("schema.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
