import type { ConnectionInfo, IndexInfo, Namespace } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import {
  CircleAlert,
  ClipboardCopy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeEJson } from "@/lib/ejson-display";
import { formatBytes } from "@/lib/format";
import { useDropIndex, useIndexes, useSetIndexHidden } from "../api/indexes";
import { createIndexCommand } from "../lib/create-index-command";
import { CreateIndexDialog } from "./create-index-dialog";
import { IndexBuilds } from "./index-builds";

interface IndexesViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  editable: boolean;
  /** Opens the create dialog with these keys (from a query plan), once. */
  draftKeys?: string | null;
  onDraftOpened?: () => void;
}

/** The indexes of one collection, with their options, size and usage. */
export function IndexesView({
  connection,
  namespace,
  editable,
  draftKeys = null,
  onDraftOpened,
}: IndexesViewProps) {
  const { t } = useTranslation("indexes");
  const indexes = useIndexes(connection.id, namespace);
  const drop = useDropIndex(connection.id, namespace);
  const setHidden = useSetIndexHidden(connection.id, namespace);
  const [creating, setCreating] = useState<string | false>(false);

  useEffect(() => {
    if (draftKeys && editable) {
      setCreating(draftKeys);
      onDraftOpened?.();
    }
  }, [draftKeys, editable, onDraftOpened]);
  const [toDrop, setToDrop] = useState<string | null>(null);
  const refetchIndexes = useCallback(() => void indexes.refetch(), [indexes.refetch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        {editable ? (
          <Button size="sm" onClick={() => setCreating("")}>
            <Plus />
            {t("toolbar.create")}
          </Button>
        ) : (
          <p className="text-muted-foreground text-xs">{t("readOnly")}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={!indexes.data?.length}
          onClick={() => {
            // `_id_` exists in every collection: recreating it is an error.
            const commands = (indexes.data ?? [])
              .filter((index) => index.name !== "_id_")
              .map((index) => createIndexCommand(namespace.collection, index));
            void navigator.clipboard.writeText(commands.join("\n"));
            toast.success(t("toolbar.allCopied", { count: commands.length }));
          }}
        >
          <ClipboardCopy />
          {t("toolbar.copyAll")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void indexes.refetch()}
          disabled={indexes.isFetching}
        >
          <RotateCw className={indexes.isFetching ? "animate-spin" : undefined} />
          {t("toolbar.refresh")}
        </Button>
      </div>

      <IndexBuilds
        connectionId={connection.id}
        namespace={namespace}
        onFinished={refetchIndexes}
        watching={creating !== false}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {indexes.isPending ? (
          <p className="flex items-center gap-2 p-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("table.loading")}
          </p>
        ) : indexes.error ? (
          <p className="flex items-center gap-2 p-6 text-destructive text-xs selectable">
            <CircleAlert className="size-4" />
            {t("table.failed", { message: indexes.error.message })}
          </p>
        ) : (
          <Table
            className="text-[13px]"
            aria-label={t("table.label", { collection: namespace.collection })}
          >
            <TableHeader className="sticky top-0 bg-sidebar text-xs">
              <TableRow className="h-8 border-b">
                <TableHead>{t("table.name")}</TableHead>
                <TableHead>{t("table.keys")}</TableHead>
                <TableHead>{t("table.properties")}</TableHead>
                <TableHead className="text-right">{t("table.size")}</TableHead>
                <TableHead className="text-right">{t("table.usage")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("table.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {indexes.data.map((index) => (
                <TableRow
                  key={index.name}
                  className="group h-11 border-b border-border/60 hover:bg-accent/40"
                >
                  <TableCell className="font-medium selectable">{index.name}</TableCell>
                  <TableCell className="font-mono text-type-structure text-xs selectable">
                    {describeEJson(index.keys).text}
                  </TableCell>
                  <TableCell>
                    <Properties index={index} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs tabular-nums">
                    {index.size == null ? "—" : formatBytes(index.size)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "px-3 text-right text-xs tabular-nums",
                      // An index never used costs writes and memory for nothing.
                      index.usageCount === 0 && index.name !== "_id_"
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  >
                    {index.usageCount == null
                      ? "—"
                      : index.usageCount === 0 && index.name !== "_id_"
                        ? t("table.unusedSince", {
                            date: index.usageSince
                              ? new Date(index.usageSince).toLocaleDateString()
                              : "",
                          })
                        : t("table.usageSince", {
                            count: index.usageCount,
                            date: index.usageSince
                              ? new Date(index.usageSince).toLocaleDateString()
                              : "",
                          })}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={t("table.copyCommand", { name: index.name })}
                      title={t("table.copyCommandHint")}
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          createIndexCommand(namespace.collection, index),
                        );
                        toast.success(t("table.commandCopied", { name: index.name }));
                      }}
                    >
                      <ClipboardCopy />
                    </Button>
                    {editable && index.name !== "_id_" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={
                          index.hidden
                            ? t("table.unhide", { name: index.name })
                            : t("table.hide", { name: index.name })
                        }
                        title={index.hidden ? t("table.unhideHint") : t("table.hideHint")}
                        disabled={setHidden.isPending}
                        onClick={() =>
                          setHidden.mutate(
                            { name: index.name, hidden: !index.hidden },
                            {
                              onSuccess: () =>
                                toast.success(
                                  index.hidden
                                    ? t("table.unhidden", { name: index.name })
                                    : t("table.hidden", { name: index.name }),
                                ),
                            },
                          )
                        }
                      >
                        {index.hidden ? <Eye /> : <EyeOff />}
                      </Button>
                    )}
                    {editable && index.name !== "_id_" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={t("table.drop", { name: index.name })}
                        onClick={() => setToDrop(index.name)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {creating !== false && (
        <CreateIndexDialog
          connectionId={connection.id}
          namespace={namespace}
          initialKeys={creating}
          onClose={() => setCreating(false)}
        />
      )}

      <AlertDialog open={toDrop !== null} onOpenChange={(open) => !open && setToDrop(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("drop.title", { name: toDrop ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("drop.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={drop.isPending}
              onClick={() =>
                toDrop &&
                drop.mutate(toDrop, {
                  onSuccess: () => {
                    toast.success(t("drop.dropped", { name: toDrop }));
                    setToDrop(null);
                  },
                })
              }
            >
              {t("drop.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Properties({ index }: { index: IndexInfo }) {
  const { t } = useTranslation("indexes");
  const badges: { label: string; hint?: string }[] = [];
  if (index.name === "_id_") badges.push({ label: t("badge.default") });
  if (index.unique) badges.push({ label: t("badge.unique") });
  if (index.sparse) badges.push({ label: t("badge.sparse") });
  if (index.hidden) badges.push({ label: t("badge.hidden") });
  if (index.expireAfterSeconds != null)
    badges.push({ label: t("badge.ttl", { seconds: index.expireAfterSeconds }) });
  if (index.partialFilter) {
    badges.push({
      label: t("badge.partial"),
      hint: t("badge.partialHint", { filter: describeEJson(index.partialFilter).text }),
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) =>
        badge.hint ? (
          <Tooltip key={badge.label}>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="cursor-default">
                {badge.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 font-mono text-xs">{badge.hint}</TooltipContent>
          </Tooltip>
        ) : (
          <Badge key={badge.label} variant="secondary">
            {badge.label}
          </Badge>
        ),
      )}
    </div>
  );
}
