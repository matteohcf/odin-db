import {
  type ChangeEvent,
  type ChangeFeed,
  type ConnectionInfo,
  commands,
  type Namespace,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { cn } from "@odin-db/ui/lib/utils";
import { Pause, Play, RadioTower, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { useOperation } from "@/hooks/use-operation";
import { createFrameBatcher } from "@/lib/frame-batcher";
import { call } from "@/lib/ipc";
import { OPERATIONS, type Operation } from "../lib/change-summary";
import { ChangeRow } from "./change-row";

/** Changes kept on screen; older ones scroll out of memory. */
const MAX_CHANGES = 500;

/** A collection's inserts, updates and deletes as they happen, from a change stream. */
export function ChangesView({
  connection,
  namespace,
}: {
  connection: ConnectionInfo;
  namespace: Namespace;
}) {
  const { t } = useTranslation("changes");
  const feed = useOperation<ChangeFeed>();
  // Each change gets a number as it arrives: rows keep their identity (and open state).
  const [changes, setChanges] = useState<{ seq: number; change: ChangeEvent }[]>([]);
  const received = useRef(0);
  const [skipped, setSkipped] = useState(0);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState<Operation[]>([...OPERATIONS]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Bursts of changes render once per frame, newest first.
  const [batcher] = useState(() =>
    createFrameBatcher<{ seq: number; change: ChangeEvent }>((items) =>
      setChanges((current) => [...items.reverse(), ...current].slice(0, MAX_CHANGES)),
    ),
  );
  const { start, cancel } = feed;

  useEffect(() => {
    void start(
      (channel) => call(commands.watchChanges(connection.id, namespace, channel)),
      (event) => {
        if (event.kind === "skipped") setSkipped((count) => count + (event.value ?? 0));
        else if (!pausedRef.current) {
          received.current += 1;
          batcher.push([{ seq: received.current, change: event.value }]);
        }
      },
    );
    return () => {
      cancel();
      batcher.cancel();
    };
  }, [connection.id, namespace, start, cancel, batcher]);

  const visible = useMemo(
    () =>
      changes.filter(
        ({ change }) =>
          !OPERATIONS.includes(change.operation as Operation) ||
          shown.includes(change.operation as Operation),
      ),
    [changes, shown],
  );
  const status = feed.state.status;
  const live = status === "running" && !paused;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span
          role="status"
          className={cn(
            "flex items-center gap-1.5 font-medium text-xs",
            live ? "text-success" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              live ? "animate-pulse bg-success" : "bg-muted-foreground/50",
            )}
          />
          {status === "running" ? (paused ? t("paused") : t("live")) : t("stopped")}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: changes.length })}
          {skipped > 0 && ` · ${t("skipped", { count: skipped })}`}
        </span>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={shown}
          onValueChange={(value) => setShown(value as Operation[])}
          aria-label={t("filter")}
          className="ml-auto"
        >
          {OPERATIONS.map((operation) => (
            <ToggleGroupItem key={operation} value={operation} className="px-2.5 text-xs">
              {t(`operations.${operation}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="sm"
          variant="outline"
          disabled={status !== "running"}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play /> : <Pause />}
          {paused ? t("resume") : t("pause")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={changes.length === 0}
          onClick={() => {
            setChanges([]);
            setSkipped(0);
          }}
        >
          <Trash2 />
          {t("clear")}
        </Button>
      </div>
      {status === "failed" ? (
        <EmptyState icon={RadioTower}>{feed.state.error}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={RadioTower}
          iconClassName={live ? "animate-pulse" : undefined}
          title={t("waiting")}
        >
          {t("waitingHint")}
        </EmptyState>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map(({ seq, change }) => (
            <ChangeRow key={seq} change={change} />
          ))}
        </ul>
      )}
    </div>
  );
}
