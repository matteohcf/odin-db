import {
  type ConnectionId,
  commands,
  type EJsonDocument,
  type JsonValue,
  type Namespace,
} from "@odin-db/bindings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { compactEJson } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";

const LIMIT = 200;

interface DistinctValuesDialogProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  field: string;
  /** Values are counted among the documents the query bar matches. */
  filter: EJsonDocument;
  onFilterBy: (value: JsonValue) => void;
  onClose: () => void;
}

/** The most common values of a field, with counts; picking one filters by it. */
export function DistinctValuesDialog({
  connectionId,
  namespace,
  field,
  filter,
  onFilterBy,
  onClose,
}: DistinctValuesDialogProps) {
  const { t } = useTranslation("documents");
  const [search, setSearch] = useState("");
  const values = useQuery({
    queryKey: ["distinct-values", connectionId, namespace, field, filter],
    queryFn: () => call(commands.distinctValues(connectionId, namespace, field, filter, LIMIT)),
    gcTime: 0,
  });
  const rows = (values.data ?? []).map((entry) => ({
    ...entry,
    count: entry.count ?? 0,
    text: entry.value === null ? t("distinct.missing") : compactEJson(entry.value).text,
  }));
  const top = Math.max(1, ...rows.map((row) => row.count));
  const query = search.trim().toLowerCase();
  const shown = query ? rows.filter((row) => row.text.toLowerCase().includes(query)) : rows;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("distinct.title", { field })}</DialogTitle>
          <DialogDescription>{t("distinct.description", { limit: LIMIT })}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("distinct.search")}
          aria-label={t("distinct.search")}
          className="h-8 text-xs"
          autoFocus
        />
        {values.isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            {t("distinct.loading")}
          </p>
        ) : values.error ? (
          <p role="alert" className="flex items-start gap-1.5 text-destructive text-xs selectable">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            {errorMessage(values.error)}
          </p>
        ) : (
          <ul
            aria-label={t("distinct.title", { field })}
            className="min-h-0 flex-1 overflow-y-auto rounded-md border"
          >
            {shown.map((row) => (
              <li key={JSON.stringify(row.value)}>
                <button
                  type="button"
                  title={t("distinct.filterBy")}
                  onClick={() => onFilterBy(row.value)}
                  className="relative flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-primary/10"
                    style={{ width: `${(row.count / top) * 100}%` }}
                  />
                  <span className="relative min-w-0 flex-1 truncate font-mono">{row.text}</span>
                  <span className="relative shrink-0 text-muted-foreground tabular-nums">
                    {row.count.toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-3 py-4 text-center text-muted-foreground text-xs">
                {t("distinct.none")}
              </li>
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
