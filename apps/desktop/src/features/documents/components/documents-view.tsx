import type {
  ConnectionInfo,
  EJsonDocument,
  EJsonValue,
  FieldSummary,
  JsonValue,
  Namespace,
  QueryPlan,
} from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import {
  ClipboardPaste,
  Code2,
  DatabaseZap,
  Download,
  FilePen,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { QueryCodeDialog } from "@/components/query-code-dialog";
import {
  DocumentEditorDialog,
  type EditorMode,
  ResultsPanel,
  ResultsStatusBar,
  useResultsController,
  useResultsState,
} from "@/features/results";
import { ExportDialog, ImportDialog } from "@/features/transfer";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { useSampleFields } from "@/hooks/use-sample-fields";
import { useShortcut } from "@/hooks/use-shortcut";
import type { JsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { toShellSyntax } from "@/lib/shell-syntax";
import {
  useCountDocuments,
  useDeleteDocument,
  useExplainFind,
  useInsertDocument,
  useReplaceDocument,
  useSetDocumentField,
} from "../api/mutations";
import { useGridFsActions } from "../hooks/use-gridfs-actions";
import { useUndo } from "../hooks/use-undo";
import { parseDocuments } from "../lib/clipboard-documents";
import { suggestIndexKeys } from "../lib/index-suggestion";
import { addFilterCondition, nextSort, simpleSort, sortText } from "../lib/query-edits";
import {
  emptyQueryForm,
  type FindQuery,
  parseQueryForm,
  type QueryField,
  type QueryForm,
} from "../lib/query-form";
import { schemaTemplate } from "../lib/schema-template";
import { historyKey, useQueryHistory } from "../store/query-history-store";
import { BulkWriteDialog } from "./bulk-write-dialog";
import { DeleteDocumentDialog } from "./delete-document-dialog";
import { DistinctValuesDialog } from "./distinct-values-dialog";
import { EditFieldDialog } from "./edit-field-dialog";
import { ExplainDialog } from "./explain-dialog";
import { PasteDocumentsDialog } from "./paste-documents-dialog";
import { QueryBar } from "./query-bar";
import { SqlDialog } from "./sql-dialog";

type EditorState =
  | { open: false }
  | { open: true; mode: EditorMode; text: string; id: EJsonValue | undefined };

interface DocumentsViewProps {
  connection: ConnectionInfo;
  namespace: Namespace;
  /** False for read-only connections and for views. */
  editable: boolean;
  isView: boolean;
  /** Opens index creation with suggested keys, from a query plan. */
  onCreateIndex?: ((keys: string) => void) | undefined;
  /** Whether this view is the one on screen, which takes the rerun shortcut. */
  active: boolean;
  /** A query handed over from elsewhere (the profiler); runs whenever its nonce changes. */
  pendingQuery?:
    | {
        filter: string;
        sort: string;
        projection?: string;
        skip?: string;
        limit?: string;
        nonce: string;
      }
    | undefined;
}

const matchAll: FindQuery = { filter: {}, sort: null, projection: null, skip: null, limit: null };
const NEW_DOCUMENT = "{\n  \n}";
const NO_FIELDS: FieldSummary[] = [];

/** Query, browse and edit the documents of one collection. */
export function DocumentsView({
  connection,
  namespace,
  editable,
  isView,
  onCreateIndex,
  active,
  pendingQuery,
}: DocumentsViewProps) {
  const { t } = useTranslation("documents");
  const label = `${namespace.database}.${namespace.collection}`;
  const results = useResultsController();
  const columns = useResultsState(results, (s) => s.columns);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);
  const [codeQuery, setCodeQuery] = useState<FindQuery | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [pasted, setPasted] = useState<EJsonDocument[] | null>(null);

  async function pasteDocuments() {
    try {
      const documents = await parseDocuments(await navigator.clipboard.readText());
      if (documents.length === 0) toast.info(t("paste.empty"));
      else setPasted(documents);
    } catch (error) {
      toast.error(t("paste.invalid", { message: errorMessage(error) }));
    }
  }
  const [distinct, setDistinct] = useState<{ field: string; filter: EJsonDocument } | null>(null);
  const [bulk, setBulk] = useState<{
    mode: "update" | "delete";
    filter: EJsonDocument;
    /** The selected documents being deleted, kept to undo the delete. */
    rows?: JsonObject[];
  } | null>(null);

  const [form, setForm] = useState<QueryForm>(emptyQueryForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<QueryField, string>>>({});
  const [running, setRunning] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState>({ open: false });
  const [toDelete, setToDelete] = useState<JsonObject | undefined>();
  const lastQuery = useRef<FindQuery>(matchAll);

  const fields = useSampleFields(connection.id, namespace);
  const completionsFor = useQueryCompletions(fields.data ?? NO_FIELDS);
  const recordQuery = useQueryHistory((state) => state.record);
  const queryHistoryKey = historyKey(
    connection.profileId,
    namespace.database,
    namespace.collection,
  );

  const insert = useInsertDocument();
  const replace = useReplaceDocument();
  const remove = useDeleteDocument();
  const count = useCountDocuments();
  const explainFind = useExplainFind();
  const setField = useSetDocumentField();
  const [fieldEdit, setFieldEdit] = useState<{ row: JsonObject; field: string } | null>(null);
  const [plan, setPlan] = useState<{ plan: QueryPlan; suggestedIndex: string | null } | null>(null);
  const target = { connectionId: connection.id, namespace };

  const execute = useCallback(
    async (query: FindQuery, { keepRows = false } = {}) => {
      lastQuery.current = query;
      if (!keepRows) setSelectedIndex(null);
      count.reset();
      setRunning(true);
      await results.run(
        (batchSize) =>
          call(commands.findDocuments(connection.id, namespace, { ...query, batchSize })),
        { keepRows },
      );
      setRunning(false);
    },
    [results, count.reset, connection.id, namespace],
  );

  async function explain() {
    const parsed = await parseQueryForm(form, { invalidNumber: t("query.invalidNumber") });
    if (!parsed.ok) {
      setFormErrors(parsed.errors);
      return;
    }
    setFormErrors({});
    const { filter, sort, projection, skip, limit } = parsed.query;
    explainFind.mutate(
      { ...target, request: { filter, sort, projection, skip, limit } },
      {
        onSuccess: (result) =>
          setPlan({ plan: result, suggestedIndex: suggestIndexKeys(filter, sort) }),
        onError: (error) => toast.error(t("explain.failed", { message: errorMessage(error) })),
      },
    );
  }

  async function runForm(toRun: QueryForm = form) {
    setForm(toRun);
    const parsed = await parseQueryForm(toRun, { invalidNumber: t("query.invalidNumber") });
    if (!parsed.ok) {
      setFormErrors(parsed.errors);
      return;
    }
    setFormErrors({});
    recordQuery(queryHistoryKey, toRun);
    await execute(parsed.query);
  }

  /** Shows the query as written in the bar, or its errors if it does not parse. */
  /** The query as written in the bar, or null after showing its errors. */
  async function currentQuery() {
    const parsed = await parseQueryForm(form, { invalidNumber: t("query.invalidNumber") });
    if (!parsed.ok) {
      setFormErrors(parsed.errors);
      return null;
    }
    setFormErrors({});
    return parsed.query;
  }

  async function showCode() {
    const query = await currentQuery();
    if (query) setCodeQuery(query);
  }

  async function openDistinct(field: string) {
    const query = await currentQuery();
    if (query) setDistinct({ field, filter: query.filter });
  }

  async function openBulk(mode: "update" | "delete") {
    const query = await currentQuery();
    if (query) setBulk({ mode, filter: query.filter });
  }

  useShortcut("rerun", () => void runForm(), active);

  const [focusFilter, setFocusFilter] = useState(0);
  useShortcut("focusFilter", () => setFocusFilter((value) => value + 1), active);
  const [askAi, setAskAi] = useState(0);
  useShortcut("askAi", () => setAskAi((value) => value + 1), active);

  /** Re-runs the last query; after a write the grid stays on screen until new rows arrive. */
  const refresh = (keepRows = false) => void execute(lastQuery.current, { keepRows });

  // A query handed over runs once per nonce, in place of the first load when there is one.
  const appliedQuery = useRef<string | undefined>(undefined);
  const runPending = useEffectEvent(() => {
    if (!pendingQuery || appliedQuery.current === pendingQuery.nonce) return false;
    appliedQuery.current = pendingQuery.nonce;
    void runForm({
      ...emptyQueryForm,
      filter: pendingQuery.filter,
      sort: pendingQuery.sort,
      projection: pendingQuery.projection ?? "",
      skip: pendingQuery.skip ?? "",
      limit: pendingQuery.limit ?? "",
    });
    return true;
  });

  // First load, and again after a reconnect binds the tab to a new connection.
  const initialLoad = useEffectEvent(() => {
    if (!runPending()) refresh();
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the tab gets a new connection.
  useEffect(() => {
    initialLoad();
  }, [connection.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new nonce is a new request.
  useEffect(() => {
    runPending();
  }, [pendingQuery?.nonce]);

  const openInsert = (text = NEW_DOCUMENT) =>
    setEditor({ open: true, mode: "insert", text, id: undefined });

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
    refresh(true);
  }

  const gridFs = useGridFsActions(connection.id, namespace, () => refresh(true));
  const { offerUndo, offerFieldUndo } = useUndo(connection.id, namespace, () => refresh(true));

  function deleteRow(row: JsonObject | undefined) {
    const id = row?._id;
    if (!row || id === undefined) return;
    remove.mutate(
      { ...target, id },
      {
        onSuccess: () => {
          offerUndo([row], t("delete.deleted"));
          setToDelete(undefined);
          refresh(true);
        },
      },
    );
  }

  async function saveField(value: JsonValue | undefined) {
    if (!fieldEdit) return;
    const { row, field } = fieldEdit;
    const id = row._id;
    if (id === undefined) return;
    const previous = row[field];
    // Errors are shown inside the dialog, which re-throws them from here.
    await setField.mutateAsync({ ...target, id, field, value });
    offerFieldUndo(
      id,
      field,
      previous,
      t(value === undefined ? "field.removed" : "field.saved", { field }),
    );
    setFieldEdit(null);
    refresh(true);
  }

  const hasFilter = form.filter.trim() !== "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryBar
        collection={namespace.collection}
        focusSignal={focusFilter}
        askSignal={askAi}
        form={form}
        errors={formErrors}
        running={running}
        onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
        onRun={() => void runForm()}
        onRunForm={(next) => void runForm(next)}
        onSetForm={setForm}
        onExplain={() => void explain()}
        explaining={explainFind.isPending}
        fields={fields.data ?? NO_FIELDS}
        historyKey={queryHistoryKey}
        actions={
          <>
            {editable && gridFs.bucket && (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("gridfs.upload")}
                title={t("gridfs.upload")}
                onClick={() => void gridFs.upload()}
              >
                <Upload />
                <span className="hidden @4xl:inline">{t("gridfs.upload")}</span>
              </Button>
            )}
            {editable && (
              <Button
                variant="outline"
                size="sm"
                aria-label={t("insert")}
                title={t("insert")}
                onClick={() => openInsert()}
              >
                <Plus />
                <span className="hidden @4xl:inline">{t("insert")}</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("menu.more", { ns: "transfer" })}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {editable && (
                  <DropdownMenuItem onSelect={() => setTransfer("import")}>
                    <Upload />
                    {t("menu.import", { ns: "transfer" })}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setTransfer("export")}>
                  <Download />
                  {t("menu.export", { ns: "transfer" })}
                </DropdownMenuItem>
                {editable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void openBulk("update")}>
                      <FilePen />
                      {t("bulk.menuUpdate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => void openBulk("delete")}
                    >
                      <Trash2 />
                      {t("bulk.menuDelete")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {editable && (
                  <DropdownMenuItem onSelect={() => void pasteDocuments()}>
                    <ClipboardPaste />
                    {t("paste.menu")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setSqlOpen(true)}>
                  <DatabaseZap />
                  {t("sql.menu")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void showCode()}>
                  <Code2 />
                  {t("queryCode.menu", { ns: "common" })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <ResultsPanel
        controller={results}
        layoutKey={queryHistoryKey}
        columnActions={{
          sort: simpleSort(form.sort) ?? [],
          onSort: (field, append) =>
            void runForm({
              ...form,
              // A sort the columns cannot show is replaced, not appended to.
              sort: sortText(nextSort(simpleSort(form.sort) ?? [], field, append)),
            }),
          onSortBy: (field, direction) =>
            void runForm({ ...form, sort: sortText([{ field, direction }]) }),
          onFilterBy: (field, value, how = "eq") => {
            const literal = value === undefined ? null : toShellSyntax(value, 0);
            const condition = {
              eq: literal ?? "{ $exists: false }",
              ne: literal === null ? "{ $exists: true }" : `{ $ne: ${literal} }`,
              gt: `{ $gt: ${literal} }`,
              lt: `{ $lt: ${literal} }`,
            }[how];
            void runForm({ ...form, filter: addFilterCondition(form.filter, field, condition) });
          },
          onDistinct: (field) => void openDistinct(field),
        }}
        label={t("results.label", { collection: namespace.collection })}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        empty={
          <>
            <p>
              {hasFilter
                ? t("results.empty")
                : isView
                  ? t("results.emptyView")
                  : t("results.emptyCollection")}
            </p>
            {hasFilter ? (
              <Button size="sm" variant="outline" onClick={() => void runForm(emptyQueryForm)}>
                {t("results.clearFilter")}
              </Button>
            ) : (
              editable && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => openInsert()}>
                    <Plus />
                    {t("insert")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void pasteDocuments()}>
                    <ClipboardPaste />
                    {t("paste.menu")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setTransfer("import")}>
                    <Upload />
                    {t("menu.import", { ns: "transfer" })}
                  </Button>
                </div>
              )
            )}
          </>
        }
        actions={{
          openMode: editable ? "edit" : "view",
          onOpen: (row) =>
            setEditor({
              open: true,
              mode: editable ? "edit" : "view",
              text: toShellSyntax(row),
              id: row._id,
            }),
          onCopy: (row) => {
            void navigator.clipboard.writeText(toShellSyntax(row));
            toast.success(t("copied"));
          },
          onDuplicate: editable
            ? (row) => {
                const { _id: _omitted, ...rest } = row;
                openInsert(toShellSyntax(rest));
              }
            : undefined,
          // Without confirmation, the undo toast is the safety net.
          onDelete: editable
            ? (row) => (useSettings.getState().confirmDelete ? setToDelete(row) : deleteRow(row))
            : undefined,
          onEditField: editable ? (row, field) => setFieldEdit({ row, field }) : undefined,
          onPaste: editable ? () => void pasteDocuments() : undefined,
          onDownloadFile: gridFs.bucket ? (row) => void gridFs.download(row) : undefined,
          onReplace: editable
            ? async (row, document) => {
                const id = row._id;
                if (id === undefined) return;
                try {
                  await replace.mutateAsync({ ...target, id, document });
                } catch (error) {
                  toast.error(errorMessage(error));
                  throw error;
                }
                toast.success(t("editor.saved"));
                refresh(true);
              }
            : undefined,
          onSetField: editable
            ? async (row, field, value) => {
                const id = row._id;
                if (id === undefined) return;
                const previous = row[field];
                try {
                  await setField.mutateAsync({ ...target, id, field, value });
                } catch (error) {
                  toast.error(errorMessage(error));
                  throw error;
                }
                offerFieldUndo(id, field, previous, t("field.saved", { field }));
                refresh(true);
              }
            : undefined,
          // Selected documents reuse the bulk dialogs, filtered by `_id`.
          onUpdateMany: editable
            ? (rows) =>
                setBulk({
                  mode: "update",
                  filter: { _id: { $in: rows.map((row) => row._id ?? null) } },
                })
            : undefined,
          onDeleteMany: editable
            ? (rows) =>
                setBulk({
                  mode: "delete",
                  filter: { _id: { $in: rows.map((row) => row._id ?? null) } },
                  rows,
                })
            : undefined,
        }}
      />

      <ResultsStatusBar
        controller={results}
        actions={
          <>
            {count.data != null && (
              <span className="tabular-nums">{t("count.result", { count: count.data })}</span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => count.mutate({ ...target, filter: lastQuery.current.filter })}
              disabled={count.isPending}
            >
              {count.isPending ? t("count.pending") : t("count.action")}
            </Button>
          </>
        }
      />

      {editor.open && (
        <DocumentEditorDialog
          open
          mode={editor.mode}
          namespace={label}
          initialText={editor.text}
          onSave={saveDocument}
          completions={completionsFor("document")}
          template={fields.data?.length ? schemaTemplate(fields.data) : undefined}
          onClose={() => setEditor({ open: false })}
        />
      )}
      {pasted && (
        <PasteDocumentsDialog
          connectionId={connection.id}
          namespace={namespace}
          documents={pasted}
          onDone={() => refresh(true)}
          onClose={() => setPasted(null)}
        />
      )}
      {sqlOpen && (
        <SqlDialog
          collection={namespace.collection}
          onUse={(next) => void runForm(next)}
          onClose={() => setSqlOpen(false)}
        />
      )}
      {distinct && (
        <DistinctValuesDialog
          connectionId={connection.id}
          namespace={namespace}
          field={distinct.field}
          filter={distinct.filter}
          onFilterBy={(value) => {
            setDistinct(null);
            void runForm({
              ...form,
              filter: addFilterCondition(form.filter, distinct.field, toShellSyntax(value, 0)),
            });
          }}
          onClose={() => setDistinct(null)}
        />
      )}
      {bulk && (
        <BulkWriteDialog
          mode={bulk.mode}
          connectionId={connection.id}
          namespace={namespace}
          filter={bulk.filter}
          completions={completionsFor("update")}
          onDone={() => refresh(true)}
          onDeleted={
            bulk.rows
              ? (count) => {
                  const rows = bulk.rows ?? [];
                  offerUndo(rows, t("bulk.deleted", { count }));
                }
              : undefined
          }
          onClose={() => setBulk(null)}
        />
      )}
      {codeQuery && (
        <QueryCodeDialog
          source={{
            kind: "find",
            database: namespace.database,
            collection: namespace.collection,
            filter: codeQuery.filter,
            projection: codeQuery.projection,
            sort: codeQuery.sort,
            skip: codeQuery.skip,
            limit: codeQuery.limit,
          }}
          onClose={() => setCodeQuery(null)}
        />
      )}
      {transfer === "export" && (
        <ExportDialog
          connectionId={connection.id}
          namespace={namespace}
          source={{ kind: "find", request: { ...lastQuery.current, batchSize: 1000 } }}
          columns={columns}
          onClose={() => setTransfer(null)}
        />
      )}
      {transfer === "import" && (
        <ImportDialog
          connectionId={connection.id}
          namespace={namespace}
          onImported={() => refresh(true)}
          onClose={() => setTransfer(null)}
        />
      )}
      <DeleteDocumentDialog
        document={toDelete}
        collection={namespace.collection}
        pending={remove.isPending}
        onConfirm={() => deleteRow(toDelete)}
        onClose={() => setToDelete(undefined)}
      />
      {fieldEdit && (
        <EditFieldDialog
          field={fieldEdit.field}
          value={fieldEdit.row[fieldEdit.field]}
          pending={setField.isPending}
          onSave={saveField}
          onClose={() => setFieldEdit(null)}
        />
      )}
      {plan && (
        <ExplainDialog
          collection={namespace.collection}
          plan={plan.plan}
          suggestedIndex={plan.suggestedIndex}
          onCreateIndex={
            onCreateIndex &&
            ((keys) => {
              setPlan(null);
              onCreateIndex(keys);
            })
          }
          onClose={() => setPlan(null)}
        />
      )}
    </div>
  );
}
