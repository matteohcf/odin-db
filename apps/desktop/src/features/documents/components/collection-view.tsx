import type { ConnectionInfo, EJsonDocument, EJsonValue, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { CircleAlert, Eye, Loader2, Lock, Plus, RotateCw } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CollectionTab } from "@/features/workspace";
import type { JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";
import {
  useCountDocuments,
  useDeleteDocument,
  useInsertDocument,
  useReplaceDocument,
} from "../api/mutations";
import { useCollectionResults, useResultsState } from "../hooks/use-collection-results";
import { emptyQueryForm, parseQueryForm, type QueryField, type QueryForm } from "../lib/query-form";
import type { ResultsQuery } from "../lib/results-controller";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { DocumentEditorDialog, type EditorMode } from "./document-editor-dialog";
import { QueryBar } from "./query-bar";
import { ResultsGrid } from "./results-grid";
import { StatusBar } from "./status-bar";

type EditorState =
  | { open: false }
  | { open: true; mode: EditorMode; text: string; id: EJsonValue | undefined };

interface CollectionViewProps {
  tab: CollectionTab;
  profileName: string;
  connection: ConnectionInfo;
}

/** A collection tab: query, browse and edit documents. */
export function CollectionView({ tab, profileName, connection }: CollectionViewProps) {
  const { t } = useTranslation("documents");
  const namespace = useMemo<Namespace>(
    () => ({ database: tab.database, collection: tab.collection }),
    [tab.database, tab.collection],
  );
  const label = `${tab.database}.${tab.collection}`;
  const isView = tab.collectionKind === "view";
  // Views are read-only in MongoDB itself, whatever the connection allows.
  const readOnly = connection.readOnly || isView;

  const results = useCollectionResults(connection.id, namespace);
  const rows = useResultsState(results, (s) => s.rows);
  const columns = useResultsState(results, (s) => s.columns);
  const status = useResultsState(results, (s) => s.status);
  const error = useResultsState(results, (s) => s.error);
  const hasMore = useResultsState(results, (s) => s.hasMore);
  const loadingMore = useResultsState(results, (s) => s.loadingMore);
  const truncated = useResultsState(results, (s) => s.truncated);
  const durationMs = useResultsState(results, (s) => s.durationMs);

  const [form, setForm] = useState<QueryForm>(emptyQueryForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<QueryField, string>>>({});
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [toDelete, setToDelete] = useState<JsonObject | undefined>();
  const lastQuery = useRef<ResultsQuery | null>(null);

  const insert = useInsertDocument();
  const replace = useReplaceDocument();
  const remove = useDeleteDocument();
  const count = useCountDocuments();
  const target = { connectionId: connection.id, namespace };

  const execute = useCallback(
    (query: ResultsQuery) => {
      lastQuery.current = query;
      setSelectedIndex(null);
      count.reset();
      void results.run(query);
    },
    [results, count.reset],
  );

  async function runForm() {
    const parsed = await parseQueryForm(form, { invalidNumber: t("query.invalidNumber") });
    if (!parsed.ok) {
      setFormErrors(parsed.errors);
      return;
    }
    setFormErrors({});
    execute(parsed.query);
  }

  const refresh = () =>
    execute(
      lastQuery.current ?? { filter: {}, sort: null, projection: null, skip: null, limit: null },
    );

  // First load, and again after a reconnect gives this tab a new connection.
  const initialLoad = useEffectEvent(refresh);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the tab gets a new connection.
  useEffect(() => {
    initialLoad();
  }, [connection.id]);

  const loadMore = useCallback(() => void results.loadMore(), [results]);

  function openRow(row: JsonObject) {
    setEditor({
      open: true,
      mode: readOnly ? "view" : "edit",
      text: toShellSyntax(row),
      id: row._id,
    });
  }

  function duplicateRow(row: JsonObject) {
    const { _id: _ignored, ...rest } = row;
    setEditor({ open: true, mode: "insert", text: toShellSyntax(rest), id: undefined });
  }

  async function copyRow(row: JsonObject) {
    await navigator.clipboard.writeText(toShellSyntax(row));
    toast.success(t("row.copied"));
  }

  async function saveDocument(document: EJsonDocument) {
    if (!editor.open) return;
    if (editor.mode === "insert") {
      await insert.mutateAsync({ ...target, document });
      toast.success(t("editor.inserted"));
    } else if (editor.id !== undefined) {
      await replace.mutateAsync({ ...target, id: editor.id, document });
      toast.success(t("editor.saved"));
    }
    setEditor({ open: false });
    refresh();
  }

  function confirmDelete() {
    const id = toDelete?._id;
    if (id === undefined) return;
    remove.mutate(
      { ...target, id },
      {
        onSuccess: () => {
          toast.success(t("delete.deleted"));
          setToDelete(undefined);
          refresh();
        },
      },
    );
  }

  return (
    <section className="flex h-full min-w-0 flex-col" aria-label={label}>
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-3">
        <nav className="flex min-w-0 items-baseline gap-1.5 text-[13px]" aria-label={label}>
          <span className="truncate text-muted-foreground">{profileName}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-muted-foreground">{tab.database}</span>
          <span className="text-muted-foreground/50">/</span>
          <h1 className="truncate font-semibold text-base">{tab.collection}</h1>
        </nav>
        {(connection.readOnly || isView) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 items-center gap-1 rounded-sm bg-warning/10 px-1.5 py-0.5 font-medium text-warning text-xs">
                {connection.readOnly ? <Lock className="size-3" /> : <Eye className="size-3" />}
                {connection.readOnly ? t("header.readOnly") : t("header.view")}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {connection.readOnly ? t("header.readOnlyHint") : t("header.viewHint")}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("header.refresh")}
                onClick={refresh}
                disabled={status === "loading"}
              >
                <RotateCw className={status === "loading" ? "animate-spin" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.refresh")}</TooltipContent>
          </Tooltip>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setEditor({ open: true, mode: "insert", text: "{\n  \n}", id: undefined })
              }
            >
              <Plus />
              {t("header.insert")}
            </Button>
          )}
        </div>
      </header>

      <QueryBar
        form={form}
        errors={formErrors}
        running={status === "loading"}
        onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
        onRun={() => void runForm()}
      />

      {status === "error" ? (
        <div className="flex flex-1 flex-col items-start gap-2 p-6">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <CircleAlert className="size-4" />
            {t("results.failed")}
          </p>
          <p className="max-w-2xl text-muted-foreground text-xs selectable">{error}</p>
        </div>
      ) : status === "loading" && rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("results.loading")}
        </div>
      ) : status === "ready" && rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>
            {form.filter.trim() !== ""
              ? t("results.empty")
              : isView
                ? t("results.emptyView")
                : t("results.emptyCollection")}
          </p>
          {!readOnly && form.filter.trim() === "" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEditor({ open: true, mode: "insert", text: "{\n  \n}", id: undefined })
              }
            >
              <Plus />
              {t("header.insert")}
            </Button>
          )}
        </div>
      ) : (
        <ResultsGrid
          label={t("results.label", { collection: tab.collection })}
          rows={rows}
          columns={columns}
          hasMore={hasMore}
          readOnly={readOnly}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onLoadMore={loadMore}
          onOpen={openRow}
          onDuplicate={duplicateRow}
          onCopy={(row) => void copyRow(row)}
          onDelete={setToDelete}
        />
      )}

      <StatusBar
        loaded={rows.length}
        hasMore={hasMore}
        loadingMore={loadingMore}
        truncated={truncated}
        durationMs={durationMs}
        pageError={status === "ready" ? error : null}
        count={{
          pending: count.isPending,
          value: count.data ?? undefined,
          onCount: () => count.mutate({ ...target, filter: lastQuery.current?.filter ?? {} }),
        }}
      />

      {editor.open && (
        <DocumentEditorDialog
          open
          mode={editor.mode}
          namespace={label}
          initialText={editor.text}
          onSave={saveDocument}
          onClose={() => setEditor({ open: false })}
        />
      )}
      <DeleteDocumentDialog
        document={toDelete}
        collection={tab.collection}
        pending={remove.isPending}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(undefined)}
      />
    </section>
  );
}
