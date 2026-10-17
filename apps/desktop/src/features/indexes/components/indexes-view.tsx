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
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { CircleAlert, Loader2, Plus, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeEJson } from "@/lib/ejson-display";
import { formatBytes } from "@/lib/format";
import { useDropIndex, useIndexes } from "../api/indexes";
import { CreateIndexDialog } from "./create-index-dialog";

interface IndexesViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  editable: boolean;
}

/** The indexes of one collection, with their options, size and usage. */
export function IndexesView({ connection, namespace, editable }: IndexesViewProps) {
  const { t } = useTranslation("indexes");
  const indexes = useIndexes(connection.id, namespace);
  const drop = useDropIndex(connection.id, namespace);
  const [creating, setCreating] = useState(false);
  const [toDrop, setToDrop] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        {editable ? (
          <Button size="sm" onClick={() => setCreating(true)}>
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
          onClick={() => void indexes.refetch()}
          disabled={indexes.isFetching}
        >
          <RotateCw className={indexes.isFetching ? "animate-spin" : undefined} />
          {t("toolbar.refresh")}
        </Button>
      </div>

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
          <table
            className="w-full border-collapse text-[13px]"
            aria-label={t("table.label", { collection: namespace.collection })}
          >
            <thead className="sticky top-0 bg-sidebar text-left text-muted-foreground text-xs">
              <tr className="h-8 border-b">
                <th className="px-3 font-medium">{t("table.name")}</th>
                <th className="px-3 font-medium">{t("table.keys")}</th>
                <th className="px-3 font-medium">{t("table.properties")}</th>
                <th className="px-3 text-right font-medium">{t("table.size")}</th>
                <th className="px-3 text-right font-medium">{t("table.usage")}</th>
                <th className="w-12 px-3">
                  <span className="sr-only">{t("table.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {indexes.data.map((index) => (
                <tr
                  key={index.name}
                  className="group h-11 border-b border-border/60 hover:bg-accent/40"
                >
                  <td className="px-3 font-medium selectable">{index.name}</td>
                  <td className="px-3 font-mono text-type-structure text-xs selectable">
                    {describeEJson(index.keys).text}
                  </td>
                  <td className="px-3">
                    <Properties index={index} />
                  </td>
                  <td className="px-3 text-right text-muted-foreground text-xs tabular-nums">
                    {index.size == null ? "—" : formatBytes(index.size)}
                  </td>
                  <td className="px-3 text-right text-muted-foreground text-xs tabular-nums">
                    {index.usageCount == null
                      ? "—"
                      : t("table.usageSince", {
                          count: index.usageCount,
                          date: index.usageSince
                            ? new Date(index.usageSince).toLocaleDateString()
                            : "",
                        })}
                  </td>
                  <td className="px-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <CreateIndexDialog
          connectionId={connection.id}
          namespace={namespace}
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
